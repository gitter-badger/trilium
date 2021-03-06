const sql = require('./sql');
const ScriptContext = require('./script_context');
const Repository = require('./repository');

async function executeNote(dataKey, note) {
    if (!note.isJavaScript()) {
        return;
    }

    const bundle = await getScriptBundle(note);

    await executeBundle(dataKey, bundle);
}

async function executeBundle(dataKey, bundle, startNote) {
    if (!startNote) {
        // this is the default case, the only exception is when we want to preserve frontend startNote
        startNote = bundle.note;
    }

    // last \r\n is necessary if script contains line comment on its last line
    const script = "async function() {\r\n" + bundle.script + "\r\n}";

    const ctx = new ScriptContext(dataKey, startNote, bundle.allNotes);

    if (await bundle.note.hasAttribute('manual_transaction_handling')) {
        return await execute(ctx, script, '');
    }
    else {
        return await sql.doInTransaction(async () => execute(ctx, script, ''));
    }
}

/**
 * This method preserves frontend startNode - that's why we start execution from currentNote and override
 * bundle's startNote.
 */
async function executeScript(dataKey, script, params, startNoteId, currentNoteId) {
    const repository = new Repository(dataKey);
    const startNote = await repository.getNote(startNoteId);
    const currentNote = await repository.getNote(currentNoteId);

    currentNote.content = `return await (${script}\r\n)(${getParams(params)})`;
    currentNote.type = 'code';
    currentNote.mime = 'application/javascript;env=backend';

    const bundle = await getScriptBundle(currentNote);

    return await executeBundle(dataKey, bundle, startNote);
}

async function execute(ctx, script, paramsStr) {
    return await (function() { return eval(`const apiContext = this;\r\n(${script}\r\n)(${paramsStr})`); }.call(ctx));
}

function getParams(params) {
    if (!params) {
        return params;
    }

    return params.map(p => {
        if (typeof p === "string" && p.startsWith("!@#Function: ")) {
            return p.substr(13);
        }
        else {
            return JSON.stringify(p);
        }
    }).join(",");
}

async function getScriptBundle(note, root = true, scriptEnv = null, includedNoteIds = []) {
    if (!note.isJavaScript() && !note.isHtml() && note.type !== 'render') {
        return;
    }

    if (!root && await note.hasAttribute('disable_inclusion')) {
        return;
    }

    if (root) {
        scriptEnv = note.getScriptEnv();
    }

    if (note.type !== 'file' && scriptEnv !== note.getScriptEnv()) {
        return;
    }

    const bundle = {
        note: note,
        script: '',
        html: '',
        allNotes: [note]
    };

    if (includedNoteIds.includes(note.noteId)) {
        return bundle;
    }

    includedNoteIds.push(note.noteId);

    const modules = [];

    for (const child of await note.getChildren()) {
        const childBundle = await getScriptBundle(child, false, scriptEnv, includedNoteIds);

        if (childBundle) {
            modules.push(childBundle.note);
            bundle.script += childBundle.script;
            bundle.html += childBundle.html;
            bundle.allNotes = bundle.allNotes.concat(childBundle.allNotes);
        }
    }

    const moduleNoteIds = modules.map(mod => mod.noteId);

    if (note.isJavaScript()) {
        bundle.script += `
apiContext.modules['${note.noteId}'] = {};
${root ? 'return ' : ''}await (async function(exports, module, require, api` + (modules.length > 0 ? ', ' : '') +
            modules.map(child => sanitizeVariableName(child.title)).join(', ') + `) {
${note.content}
})({}, apiContext.modules['${note.noteId}'], apiContext.require(${JSON.stringify(moduleNoteIds)}), apiContext.apis['${note.noteId}']` + (modules.length > 0 ? ', ' : '') +
            modules.map(mod => `apiContext.modules['${mod.noteId}'].exports`).join(', ') + `);
`;
    }
    else if (note.isHtml()) {
        bundle.html += note.content;
    }

    return bundle;
}

function sanitizeVariableName(str) {
    return str.replace(/[^a-z0-9_]/gim, "");
}

module.exports = {
    executeNote,
    executeScript,
    getScriptBundle
};