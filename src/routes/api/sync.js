"use strict";

const express = require('express');
const router = express.Router();
const auth = require('../../services/auth');
const sync = require('../../services/sync');
const syncUpdate = require('../../services/sync_update');
const sync_table = require('../../services/sync_table');
const sql = require('../../services/sql');
const options = require('../../services/options');
const content_hash = require('../../services/content_hash');
const log = require('../../services/log');
const wrap = require('express-promise-wrap').wrap;

router.get('/check', auth.checkApiAuth, wrap(async (req, res, next) => {
    res.send({
        'hashes': await content_hash.getHashes(),
        'max_sync_id': await sql.getValue('SELECT MAX(id) FROM sync')
    });
}));

router.post('/now', auth.checkApiAuth, wrap(async (req, res, next) => {
    res.send(await sync.sync());
}));

router.post('/fill-sync-rows', auth.checkApiAuth, wrap(async (req, res, next) => {
    await sql.doInTransaction(async () => {
        await sync_table.fillAllSyncRows();
    });

    log.info("Sync rows have been filled.");

    res.send({});
}));

router.post('/force-full-sync', auth.checkApiAuth, wrap(async (req, res, next) => {
    await sql.doInTransaction(async () => {
        await options.setOption('last_synced_pull', 0);
        await options.setOption('last_synced_push', 0);
    });

    log.info("Forcing full sync.");

    // not awaiting for the job to finish (will probably take a long time)
    sync.sync();

    res.send({});
}));

router.post('/force-note-sync/:noteId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteId = req.params.noteId;

    await sql.doInTransaction(async () => {
        await sync_table.addNoteSync(noteId);

        for (const noteTreeId of await sql.getColumn("SELECT noteTreeId FROM note_tree WHERE isDeleted = 0 AND noteId = ?", [noteId])) {
            await sync_table.addNoteTreeSync(noteTreeId);
            await sync_table.addRecentNoteSync(noteTreeId);
        }

        for (const noteRevisionId of await sql.getColumn("SELECT noteRevisionId FROM note_revisions WHERE noteId = ?", [noteId])) {
            await sync_table.addNoteHistorySync(noteRevisionId);
        }
    });

    log.info("Forcing note sync for " + noteId);

    // not awaiting for the job to finish (will probably take a long time)
    sync.sync();

    res.send({});
}));

router.get('/changed', auth.checkApiAuth, wrap(async (req, res, next) => {
    const lastSyncId = parseInt(req.query.lastSyncId);

    res.send(await sql.getRows("SELECT * FROM sync WHERE id > ?", [lastSyncId]));
}));

router.get('/notes/:noteId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteId = req.params.noteId;
    const entity = await sql.getRow("SELECT * FROM notes WHERE noteId = ?", [noteId]);

    sync.serializeNoteContentBuffer(entity);

    res.send({
        entity: entity
    });
}));

router.get('/note_tree/:noteTreeId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteTreeId = req.params.noteTreeId;

    res.send(await sql.getRow("SELECT * FROM note_tree WHERE noteTreeId = ?", [noteTreeId]));
}));

router.get('/note_revisions/:noteRevisionId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteRevisionId = req.params.noteRevisionId;

    res.send(await sql.getRow("SELECT * FROM note_revisions WHERE noteRevisionId = ?", [noteRevisionId]));
}));

router.get('/options/:name', auth.checkApiAuth, wrap(async (req, res, next) => {
    const name = req.params.name;
    const opt = await sql.getRow("SELECT * FROM options WHERE name = ?", [name]);

    if (!opt.isSynced) {
        res.send("This option can't be synced.");
    }
    else {
        res.send(opt);
    }
}));

router.get('/note_reordering/:parentNoteId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const parentNoteId = req.params.parentNoteId;

    res.send({
        parentNoteId: parentNoteId,
        ordering: await sql.getMap("SELECT noteTreeId, notePosition FROM note_tree WHERE parentNoteId = ? AND isDeleted = 0", [parentNoteId])
    });
}));

router.get('/recent_notes/:noteTreeId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteTreeId = req.params.noteTreeId;

    res.send(await sql.getRow("SELECT * FROM recent_notes WHERE noteTreeId = ?", [noteTreeId]));
}));

router.get('/images/:imageId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const imageId = req.params.imageId;
    const entity = await sql.getRow("SELECT * FROM images WHERE imageId = ?", [imageId]);

    if (entity && entity.data !== null) {
        entity.data = entity.data.toString('base64');
    }

    res.send(entity);
}));

router.get('/note_images/:noteImageId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteImageId = req.params.noteImageId;

    res.send(await sql.getRow("SELECT * FROM note_images WHERE noteImageId = ?", [noteImageId]));
}));

router.get('/attributes/:attributeId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const attributeId = req.params.attributeId;

    res.send(await sql.getRow("SELECT * FROM attributes WHERE attributeId = ?", [attributeId]));
}));

router.get('/api_tokens/:apiTokenId', auth.checkApiAuth, wrap(async (req, res, next) => {
    const apiTokenId = req.params.apiTokenId;

    res.send(await sql.getRow("SELECT * FROM api_tokens WHERE apiTokenId = ?", [apiTokenId]));
}));

router.put('/notes', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateNote(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/note_tree', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateNoteTree(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/note_revisions', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateNoteHistory(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/note_reordering', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateNoteReordering(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/options', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateOptions(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/recent_notes', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateRecentNotes(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/images', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateImage(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/note_images', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateNoteImage(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/attributes', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateAttribute(req.body.entity, req.body.sourceId);

    res.send({});
}));

router.put('/api_tokens', auth.checkApiAuth, wrap(async (req, res, next) => {
    await syncUpdate.updateApiToken(req.body.entity, req.body.sourceId);

    res.send({});
}));

module.exports = router;