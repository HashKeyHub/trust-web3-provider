// Copyright © 2017-2020 Trust Wallet.
//
// This file is part of Trust. The full Trust copyright notice, including
// terms governing use, modification, and redistribution, is contained in the
// file LICENSE at the root of the source code distribution tree.

"use strict";

import RPCServer from "./rpc";
import ProviderRpcError from "./error";
import Utils from "./utils";
import IdMapping from "./id_mapping";
import { EventEmitter } from "events";
import isUtf8 from "isutf8";
import { TypedDataUtils } from 'cfx-sig-util'
import * as confluxJSSDK from 'js-conflux-sdk'

class ConfluxPortalProvider extends EventEmitter {
  constructor(config) {
    super();
    this.setConfig(config);

    this.idMapping = new IdMapping();
    this.callbacks = new Map();
    this.isTrust = true;
    this.isDebug = !!config.isDebug;

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

    this.chainId = config.chainId;
    this.networkVersion = config.chainId.toString(10);
    this.rpc = new RPCServer(config.rpcUrl);
    this.isDebug = !!config.isDebug;
  }

  request(payload) {
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof ConfluxPortalProvider)) {
      that = window.conflux;
    }
    return that._request(payload);
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
    console.log(
      'enable() is deprecated, please use window.conflux.request({method: "eth_requestAccounts"}) instead.'
    );
    return this.request({ method: "eth_requestAccounts", params: [] });
  }

  /**
   * @deprecated Use request() method instead.
   */
  send(payload) {
    let response = { jsonrpc: "2.0", id: payload.id };
    switch (payload.method) {
      case "eth_accounts":
      case "cfx_accounts":
        response.result = this.eth_accounts();
        break;
      case "eth_coinbase":
      case "cfx_coinbase":
        response.result = this.eth_coinbase();
        break;
      case "net_version":
        response.result = this.net_version();
        break;
      case "eth_chainId":
      case "cfx_chainId":
        response.result = this.eth_chainId();
        break;
      default:
        throw new ProviderRpcError(
          4200,
          `Trust does not support calling ${payload.method} synchronously without a callback. Please provide a callback parameter to call ${payload.method} asynchronously.`
        );
    }
    return response;
  }

  /**
   * @deprecated Use request() method instead.
   */
  sendAsync(payload, callback) {
    console.log(
      "sendAsync(data, callback) is deprecated, please use window.conflux.request(data) instead."
    );
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof ConfluxPortalProvider)) {
      that = window.conflux;
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
  _request(payload) {
    this.idMapping.tryIntifyId(payload);
    if (this.isDebug) {
      console.log(`==> _request payload ${JSON.stringify(payload)}`);
    }
    return new Promise((resolve, reject) => {
      if (!payload.id) {
        payload.id = Utils.genId();
      }
      this.callbacks.set(payload.id, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      });
      window.myCallBack = this.callbacks.get(payload.id)
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
          window.myCallBack = this.callbacks.get(payload.id);
          return this.eth_sign(payload);
        case "personal_sign":
          window.myCallBack = this.callbacks.get(payload.id);
          return this.personal_sign(payload);
        case "personal_ecRecover":
          window.myCallBack = this.callbacks.get(payload.id);
          return this.personal_ecRecover(payload);
        case "eth_signTypedData":
        case "cfx_signTypedData":
        case "cfx_signTypedData_v3":
        case "eth_signTypedData_v3":
          window.myCallBack = this.callbacks.get(payload.id);
          return this.eth_signTypedData(payload, false);
        case "eth_signTypedData_v4":
        case "cfx_signTypedData_v4":
          window.myCallBack = this.callbacks.get(payload.id);
          return this.eth_signTypedData(payload, true);
        case "eth_sendTransaction":
        case "cfx_sendTransaction":
          window.myCallBack = this.callbacks.get(payload.id);
          return this.eth_sendTransaction(payload);
        case "eth_requestAccounts":
        case "cfx_requestAccounts":
          window.myCallBack = this.callbacks.get(payload.id);
          return this.eth_requestAccounts(payload);
        case "eth_newFilter":
        case "eth_newBlockFilter":
        case "eth_newPendingTransactionFilter":
        case "eth_uninstallFilter":
        case "eth_subscribe":
          throw new ProviderRpcError(
            4200,
            `Trust does not support calling ${payload.method}. Please use your own solution`
          );
        default:
          // call upstream rpc
          this.callbacks.delete(payload.id);
          return this.rpc
            .call(payload)
            .then((response) => {
              if (this.isDebug) {
                console.log(`<== rpc response ${JSON.stringify(response)}`);
              }
              resolve(response);
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
    return this.chainId.toString(10) || null;
  }

  eth_chainId() {
    return "0x" + this.chainId.toString(16);
  }

  eth_sign(payload) {
    const buffer = Utils.messageToBuffer(payload.params[1]);
    const hex = Utils.bufferToHex(buffer);
    if (isUtf8(buffer)) {
      this.postMessage("signPersonalMessage", payload.id, { data: hex });
    } else {
      this.postMessage("signMessage", payload.id, { data: hex });
    }
  }

  personal_sign(payload) {
    const message = payload.params[0];
    const buffer = Utils.messageToBuffer(message);
    if (buffer.length === 0) {
      // hex it
      const hex = Utils.bufferToHex(message);
      this.postMessage("signPersonalMessage", payload.id, { data: hex });
    } else {
      this.postMessage("signPersonalMessage", payload.id, { data: message });
    }
  }

  personal_ecRecover(payload) {
    this.postMessage("ecRecover", payload.id, {
      signature: payload.params[1],
      message: payload.params[0],
    });
  }

  eth_signTypedData(payload, useV4) {
    const message = JSON.parse(payload.params[1]);
    const hash = TypedDataUtils.sign(message, useV4);
    this.postMessage("signTypedMessage", payload.id, {
      data: "0x" + hash.toString("hex"),
      raw: payload.params[1],
    });
  }

  eth_sendTransaction(payload) {
    this.postMessage("signTransaction", payload.id, payload.params[0]);
  }

  eth_requestAccounts(payload) {
    this.postMessage("requestAccounts", payload.id, {});
  }

  /**
   * @private Internal js -> native message handler
   */
  postMessage(handler, id, data) {
    if (this.ready || handler === "requestAccounts") {
      let object = {
        id: id,
        method: handler,
        params: data,
      };
      // me-app js文件定义
      window.postMessage(false, object);
    } else {
      // don't forget to verify in the app
      this.sendError(id, new ProviderRpcError(4100, "provider is not ready"));
    }
  }

  /**
   * @private Internal native result -> js
   */
  sendResponse(id, result, method = '') {
    let originId = this.idMapping.tryPopId(id) || id;
    let callback = this.callbacks.get(id) ? this.callbacks.get(id) : window.myCallBack;
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
      method == "requestAccounts" ? callback(null, result) : callback(null, data);
    } else {
      console.log(`callback id: ${id} not found`);
    }
    this.callbacks.delete(id);
  }

  /**
   * @private Internal native error -> js
   */
  sendError(id, error) {
    console.log(`<== ${id} sendError ${error}`);
    let callback = this.callbacks.get(id) ? this.callbacks.get(id) : window.myCallBack;
    if (callback) {
      callback(error instanceof Error ? error : new Error(error ? error : ""), null);
      this.callbacks.delete(id);
    }
  }

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
}

var cfxConfig = {
  address: cfxAddressHex,
  chainId: cfxNetworkId,
  rpcUrl: cfxRpcUrl,
  isDebug: true,
};
var cfxProvider = new ConfluxPortalProvider(cfxConfig);
cfxProvider.isConfluxPortal = true;
window.conflux = cfxProvider;
window.conflux.on = () => { };
window.ConfluxJSSDK = confluxJSSDK;
window.confluxJS = new confluxJSSDK.Conflux({
  url: cfxConfig.rpcUrl,
  networkId: cfxConfig.chainId
});
window.confluxJS.provider = cfxProvider;
window.confluxJS.defaultAccount = cfxConfig.address;