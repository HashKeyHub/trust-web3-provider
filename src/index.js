// Copyright © 2017-2020 Trust Wallet.
//
// This file is part of Trust. The full Trust copyright notice, including
// terms governing use, modification, and redistribution, is contained in the
// file LICENSE at the root of the source code distribution tree.

"use strict";

if (typeof BigInt === 'undefined') global.BigInt = require('big-integer')
if (typeof CfxSinUtil === 'undefined') global.CfxSinUtil = require('cfx-sig-util')

import Web3 from "web3";
import RPCServer from "./rpc";
import ProviderRpcError from "./error";
import IdMapping from "./id_mapping";
import { EventEmitter } from "events";
import isUtf8 from "isutf8";
import { TypedDataUtils } from "eth-sig-util";
import * as confluxJSSDK from 'js-conflux-sdk';
import { Buffer } from "buffer";

class TrustWeb3Provider extends EventEmitter {
  constructor(config) {
    super();
    this.setConfig(config);
    this.idMapping = new IdMapping();
    this.isDebug = !!config.isDebug;
    this.isEthereum = !!config.isEthereum;
    if (!window.hashKeyMeCallbacks) {
      window.hashKeyMeCallbacks = new Map();
    }
    if (!window.hashKeyMeWrapResults) {
      window.hashKeyMeWrapResults = new Map();
    }
    this.emitConnect(config.chainId);
  }

  setAddress(address) {
    const lowerAddress = (address || "").toLowerCase();
    this.address = lowerAddress;
    this.selectedAddress = lowerAddress;
    this.ready = !!address;
  }

  setConfig(config) {
    this.setAddress(config.address);
    this.chainId = '0x' + config.chainId.toString(16);
    this.networkVersion = config.chainId.toString(10);
    this.rpc = new RPCServer(config.rpcUrl);
  }

  request(payload) {
    if (this.isDebug) {
      console.log('use request')
    }

    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof TrustWeb3Provider)) {
      that = this.isEthereum ? window.ethereum : window.conflux;
    }
    return that._request(payload, false);
  }

  /**
   * @deprecated Listen to "connect" event instead.
   */
  isConnected() {
    return true;
  }

  /**
   * @deprecated Use request({method: "eth_requestAccounts"}) instead.
   */
  enable() {
    if (this.isDebug) {
      console.log('enable() use')
    }
    return this.request({ method: "eth_requestAccounts", params: [] });
  }

  /**
   * @deprecated Use request() method instead.
   */
  async send(payload, callback) {
    if (this.isDebug) {
      console.log('use send')
      console.log('send ' + JSON.stringify(payload))
    }

    if (callback) {
      this.sendAsync(payload, callback)
    } else {
      let response = { jsonrpc: "2.0", id: payload.id };
      let isString = typeof payload == 'string'
      var method = isString ? payload : payload.method
      var result = ''
      switch (method) {
        case "eth_accounts":
        case "cfx_accounts":
          result = this.eth_accounts();
          response.result = result
          return isString ? result : response
        case "eth_coinbase":
        case "cfx_coinbase":
          result = this.eth_coinbase();
          response.result = result
          return isString ? result : response
        case "net_version":
          result = this.net_version();
          response.result = result
          return isString ? result : response;
        case "eth_chainId":
        case "cfx_chainId":
          result = this.eth_chainId();
          response.result = result
          return isString ? result : response
        default:
          let msg = `Trust does not support calling ${payload.method} synchronously without a callback. Please provide a callback parameter to call ${payload.method} asynchronously.`
          if (this.isDebug) {
            console.log(msg)
          }
          throw new ProviderRpcError(4200, msg);
      }
    }
  }


  /**
   * @deprecated Use request() method instead.
   */
  sendAsync(payload, callback) {
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof TrustWeb3Provider)) {
      that = this.isEthereum ? window.ethereum : window.conflux;
    }
    if (Array.isArray(payload)) {
      Promise.all(payload.map(that._request.bind(that)))
        .then((data) => callback(null, data))
        .catch((error) => callback(error, null));
    } else {
      that
        ._request(payload)
        .then((data) => callback(null, data))
        .catch((error) => callback(error, null));
    }
  }

  /**
   * @private Internal rpc handler
   */
  _request(payload, wrapResult = true) {
    this.idMapping.tryIntifyId(payload);
    if (this.isDebug) {
      console.log(`==> _request payload ${JSON.stringify(payload)}`);
    }
    return new Promise((resolve, reject) => {
      if (!payload.id) {
        payload.id = this.genId();
      }
      window.hashKeyMeCallbacks.set(payload.id, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      });
      window.hashKeyMeWrapResults.set(payload.id, wrapResult);
      switch (payload.method) {
        case "eth_accounts":
        case "cfx_accounts":
          return this.sendResponse(payload.id, this.eth_accounts());
        case "eth_coinbase":
        case "cfx_coinbase":
          return this.sendResponse(payload.id, this.eth_coinbase());
        case "net_version":
          return this.sendResponse(payload.id, this.net_version());
        case "eth_chainId":
        case "cfx_chainId":
          return this.sendResponse(payload.id, this.eth_chainId());
        case "eth_sign":
        case "cfx_sign":
          return this.eth_sign(payload);
        case "personal_sign":
          return this.personal_sign(payload);
        case "personal_ecRecover":
          return this.personal_ecRecover(payload);
        case "eth_signTypedData":
        case "cfx_signTypedData":
        case "cfx_signTypedData_v3":
        case "eth_signTypedData_v3":
          return this.eth_signTypedData(payload, false);
        case "eth_signTypedData_v4":
        case "cfx_signTypedData_v4":
          return this.eth_signTypedData(payload, true);
        case "eth_sendTransaction":
        case "cfx_sendTransaction":
          return this.eth_sendTransaction(payload);
        case "eth_requestAccounts":
        case "cfx_requestAccounts":
          return this.eth_requestAccounts(payload);
        case "wallet_watchAsset":
          return this.wallet_watchAsset(payload);
        case "wallet_addEthereumChain":
          return this.wallet_addEthereumChain(payload);
        case "wallet_switchEthereumChain":
          return this.wallet_switchEthereumChain(payload);
        case "eth_newFilter":
        case "eth_newBlockFilter":
        case "eth_newPendingTransactionFilter":
        case "eth_uninstallFilter":
        case "eth_subscribe":
          if (this.isDebug) {
            console.log(`Trust does not support calling ${payload.method}. Please use your own solution`)
          }
          throw new ProviderRpcError(
            4200,
            `Trust does not support calling ${payload.method}. Please use your own solution`
          );
        default:
          // call upstream rpc
          window.hashKeyMeCallbacks.delete(payload.id);
          window.hashKeyMeWrapResults.delete(payload.id);
          return this.rpc
            .call(payload)
            .then((response) => {
              if (this.isDebug) {
                console.log(`<== rpc response ${JSON.stringify(response)}`, wrapResult);
              }
              wrapResult ? resolve(response) : resolve(response.result);
            })
            .catch(reject);

      }
    });
  }

  emitConnect(chainId) {
    this.emit("connect", { chainId: chainId });
  }

  eth_accounts() {
    return this.address ? [this.address] : [];
  }

  eth_coinbase() {
    return this.address;
  }

  net_version() {
    return this.networkVersion || null;
  }

  eth_chainId() {
    return this.chainId;
  }

  eth_sign(payload) {
    if (this.isDebug) {
      console.log('eth_sign ' + JSON.stringify(payload))
    }
    const buffer = this.messageToBuffer(payload.params[1]);
    const hex = this.bufferToHex(buffer);
    if (isUtf8(buffer)) {
      this.hashKeyMeMessage("signPersonalMessage", payload.id, { raw: payload.params[1], data: hex });
    } else {
      this.hashKeyMeMessage("signMessage", payload.id, { raw: payload.params[1], data: hex });
    }
  }

  personal_sign(payload) {
    if (this.isDebug) {
      console.log('personal_sign ' + JSON.stringify(payload))
    }
    const message = payload.params[0];
    const buffer = this.messageToBuffer(message);
    if (buffer.length === 0) {
      // hex it
      const hex = this.bufferToHex(message);
      this.hashKeyMeMessage("signPersonalMessage", payload.id, { raw: message, data: hex });
    } else {
      this.hashKeyMeMessage("signPersonalMessage", payload.id, { raw: message, data: message });
    }
  }

  personal_ecRecover(payload) {
    this.hashKeyMeMessage("ecRecover", payload.id, {
      signature: payload.params[1],
      message: payload.params[0],
    });
  }

  eth_signTypedData(payload, useV4) {
    const message = JSON.parse(payload.params[1]);
    const hash = this.isEthereum ?
      TypedDataUtils.sign(message, useV4) :
      CfxSinUtil.TypedDataUtils.sign(message, useV4);
    this.hashKeyMeMessage("signTypedMessage", payload.id, {
      data: "0x" + hash.toString("hex"),
      raw: payload.params[1],
    });
  }

  eth_sendTransaction(payload) {
    this.hashKeyMeMessage("signTransaction", payload.id, payload.params[0]);
  }

  eth_requestAccounts(payload) {
    this.hashKeyMeMessage("requestAccounts", payload.id, {});
  }

  wallet_watchAsset(payload) {
    let options = payload.params.options;
    this.hashKeyMeMessage("watchAsset", payload.id, {
      type: payload.type,
      contract: options.address,
      symbol: options.symbol,
      decimals: options.decimals || 0,
    });
  }

  wallet_addEthereumChain(payload) {
    this.hashKeyMeMessage("addEthereumChain", payload.id, payload.params[0]);
  }

  wallet_switchEthereumChain(payload) {
    this.hashKeyMeMessage("switchEthereumChain", payload.id, payload.params[0]);
  }

  /**
   * @private Internal js -> native message handler
   */
  hashKeyMeMessage(handler, id, data) {
    if (this.ready || handler === "requestAccounts") {
      let object = {
        id: id,
        method: handler,
        params: data,
      };
      // me-app js文件定义
      window.hashKeyMeMessage(this.isEthereum, object);
    } else {
      // don't forget to verify in the app
      this.sendError(id, new ProviderRpcError(4100, "provider is not ready"));
    }
  }

  /**
   * @private Internal native result -> js
   */
  sendResponse(id, result) {
    let originId = this.idMapping.tryPopId(id) || id;
    let callback = window.hashKeyMeCallbacks.get(id);
    let data = { jsonrpc: "2.0", id: originId };
    if (result && typeof result === "object" && result.jsonrpc && result.result) {
      data.result = result.result;
    } else {
      data.result = result;
    }
    if (this.isDebug) {
      console.log(
        `<== sendResponse id: ${id}, result: ${JSON.stringify(
          result
        )}, data: ${JSON.stringify(data)}`
      );
    }
    if (callback) {
      var wrapResult = window.hashKeyMeWrapResults.get(id);
      wrapResult ? callback(null, data) : callback(null, result)
      window.hashKeyMeWrapResults.delete(id)
      window.hashKeyMeCallbacks.delete(id);
    } else {
      this.sendError(id, `callback id: ${id} not found`);
    }
  }

  /**
   * @private Internal native error -> js
   */
  sendError(id, error) {
    console.log(`<== ${id} sendError ${error}`);
    let callback = window.hashKeyMeCallbacks.get(id);
    if (callback) {
      callback(error instanceof Error ? error : new Error(error ? error : "error is undefined"), null);
      window.hashKeyMeCallbacks.delete(id);
      window.hashKeyMeWrapResults.delete(id);
    }
  }

  /**
   * for conflux
   */
  async call(method, ...params) {
    const data = { jsonrpc: '2.0', method, params };
    return new Promise((resolve, reject) => {
      this.sendAsync(data, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result.result);
        }
      });
    });
  }

  messageToBuffer(message) {
    var buffer = Buffer.from([]);
    try {
      if ((typeof (message) === "string")) {
        buffer = Buffer.from(message.replace("0x", ""), "hex");
      } else {
        buffer = Buffer.from(message);
      }
    } catch (err) {
      console.log(`messageToBuffer error: ${err}`);
    }
    return buffer;
  }

  bufferToHex(buf) {
    return "0x" + Buffer.from(buf, 'utf-8').toString("hex");
  }

  genId() {
    return new Date().getTime() + Math.floor(Math.random() * 1000);
  }
}

window.Web3 = Web3;
window.TrustWeb3Provider = TrustWeb3Provider;
window.ConfluxJSSDK = confluxJSSDK;
window.chrome = {
  webstore: {}
};