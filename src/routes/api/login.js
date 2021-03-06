"use strict";

const express = require('express');
const router = express.Router();
const options = require('../../services/options');
const utils = require('../../services/utils');
const source_id = require('../../services/source_id');
const auth = require('../../services/auth');
const password_encryption = require('../../services/password_encryption');
const protected_session = require('../../services/protected_session');
const app_info = require('../../services/app_info');
const wrap = require('express-promise-wrap').wrap;

router.post('/sync', wrap(async (req, res, next) => {
    const timestampStr = req.body.timestamp;

    const timestamp = utils.parseDateTime(timestampStr);

    const now = new Date();

    if (Math.abs(timestamp.getTime() - now.getTime()) > 5000) {
        res.status(400);
        res.send({ message: 'Auth request time is out of sync' });
    }

    const dbVersion = req.body.dbVersion;

    if (dbVersion !== app_info.db_version) {
        res.status(400);
        res.send({ message: 'Non-matching db versions, local is version ' + app_info.db_version });
    }

    const documentSecret = await options.getOption('document_secret');
    const expectedHash = utils.hmac(documentSecret, timestampStr);

    const givenHash = req.body.hash;

    if (expectedHash !== givenHash) {
        res.status(400);
        res.send({ message: "Sync login hash doesn't match" });
    }

    req.session.loggedIn = true;

    res.send({
        sourceId: source_id.getCurrentSourceId()
    });
}));

// this is for entering protected mode so user has to be already logged-in (that's the reason we don't require username)
router.post('/protected', auth.checkApiAuth, wrap(async (req, res, next) => {
    const password = req.body.password;

    if (!await password_encryption.verifyPassword(password)) {
        res.send({
            success: false,
            message: "Given current password doesn't match hash"
        });

        return;
    }

    const decryptedDataKey = await password_encryption.getDataKey(password);

    const protectedSessionId = protected_session.setDataKey(req, decryptedDataKey);

    res.send({
        success: true,
        protectedSessionId: protectedSessionId
    });
}));

module.exports = router;