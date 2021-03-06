"use strict";

const express = require('express');
const router = express.Router();
const sql = require('../../services/sql');
const options = require('../../services/options');
const utils = require('../../services/utils');
const auth = require('../../services/auth');
const config = require('../../services/config');
const protected_session = require('../../services/protected_session');
const sync_table = require('../../services/sync_table');
const wrap = require('express-promise-wrap').wrap;

router.get('/', auth.checkApiAuth, wrap(async (req, res, next) => {
    const notes = await sql.getRows(`
      SELECT 
        note_tree.*, 
        notes.title, 
        notes.isProtected,
        notes.type
      FROM 
        note_tree 
      JOIN 
        notes ON notes.noteId = note_tree.noteId
      WHERE 
        notes.isDeleted = 0 
        AND note_tree.isDeleted = 0
      ORDER BY 
        notePosition`);

    protected_session.decryptNotes(req, notes);

    const hiddenInAutocomplete = await sql.getColumn(`
      SELECT 
        DISTINCT noteId 
      FROM 
        attributes
        JOIN notes USING(noteId)
      WHERE
        attributes.name = 'hide_in_autocomplete' 
        AND attributes.isDeleted = 0
        AND notes.isDeleted = 0`);

    res.send({
        instanceName: config.General ? config.General.instanceName : null,
        notes: notes,
        hiddenInAutocomplete: hiddenInAutocomplete,
        start_note_path: await options.getOption('start_note_path')
    });
}));

router.put('/:noteTreeId/set-prefix', auth.checkApiAuth, wrap(async (req, res, next) => {
    const noteTreeId = req.params.noteTreeId;
    const sourceId = req.headers.source_id;
    const prefix = utils.isEmptyOrWhitespace(req.body.prefix) ? null : req.body.prefix;

    await sql.doInTransaction(async () => {
        await sql.execute("UPDATE note_tree SET prefix = ?, dateModified = ? WHERE noteTreeId = ?", [prefix, utils.nowDate(), noteTreeId]);

        await sync_table.addNoteTreeSync(noteTreeId, sourceId);
    });

    res.send({});
}));

module.exports = router;
