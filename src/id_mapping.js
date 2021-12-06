// Copyright © 2017-2020 Trust Wallet.
//
// This file is part of Trust. The full Trust copyright notice, including
// terms governing use, modification, and redistribution, is contained in the
// file LICENSE at the root of the source code distribution tree.

"use strict";

class IdMapping {
  constructor() {
    this.intIds = new Map;
  }

  tryIntifyId(payload) {
    if (!payload.id) {
      payload.id = this.genId();
      return;
    }
    if (typeof payload.id !== "number") {
      let newId = genId();
      this.intIds.set(newId, payload.id);
      payload.id = newId;
    }
  }

  tryRestoreId(payload) {
    let id = this.tryPopId(payload.id);
    if (id) {
      payload.id = id;
    }
  }

  tryPopId(id) {
    let originId = this.intIds.get(id);
    if (originId) {
      this.intIds.delete(id);
    }
    return originId;
  }

  genId() {
    return new Date().getTime() + Math.floor(Math.random() * 1000);
  }

}

module.exports = IdMapping;
