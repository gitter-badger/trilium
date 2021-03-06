"use strict";

const log = require('./log');
const dataDir = require('./data_dir');
const fs = require('fs');
const sqlite = require('sqlite');
const app_info = require('./app_info');
const resource_dir = require('./resource_dir');

async function createConnection() {
    return await sqlite.open(dataDir.DOCUMENT_PATH, {Promise});
}

const dbConnected = createConnection();

let dbReadyResolve = null;
const dbReady = new Promise((resolve, reject) => {
    dbConnected.then(async db => {
        await execute("PRAGMA foreign_keys = ON");

        dbReadyResolve = () => {
            log.info("DB ready.");

            resolve(db);
        };

        const tableResults = await getRows("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'");
        if (tableResults.length !== 1) {
            log.info("Connected to db, but schema doesn't exist. Initializing schema ...");

            const schema = fs.readFileSync(resource_dir.DB_INIT_DIR + '/schema.sql', 'UTF-8');
            const notesSql = fs.readFileSync(resource_dir.DB_INIT_DIR + '/main_notes.sql', 'UTF-8');
            const notesTreeSql = fs.readFileSync(resource_dir.DB_INIT_DIR + '/main_note_tree.sql', 'UTF-8');
            const imagesSql = fs.readFileSync(resource_dir.DB_INIT_DIR + '/main_images.sql', 'UTF-8');
            const notesImageSql = fs.readFileSync(resource_dir.DB_INIT_DIR + '/main_note_images.sql', 'UTF-8');

            await doInTransaction(async () => {
                await executeScript(schema);
                await executeScript(notesSql);
                await executeScript(notesTreeSql);
                await executeScript(imagesSql);
                await executeScript(notesImageSql);

                const startNoteId = await getValue("SELECT noteId FROM note_tree WHERE parentNoteId = 'root' AND isDeleted = 0 ORDER BY notePosition");

                await require('./options').initOptions(startNoteId);
                await require('./sync_table').fillAllSyncRows();
            });

            log.info("Schema and initial content generated. Waiting for user to enter username/password to finish setup.");

            // we don't resolve dbReady promise because user needs to setup the username and password to initialize
            // the database
        }
        else {
            if (!await isUserInitialized()) {
                log.info("Login/password not initialized. DB not ready.");

                return;
            }

            if (!await isDbUpToDate()) {
                return;
            }

            resolve(db);
        }
    })
    .catch(e => {
        console.log("Error connecting to DB.", e);
        process.exit(1);
    });
});

function setDbReadyAsResolved() {
    dbReadyResolve();
}

async function insert(table_name, rec, replace = false) {
    const keys = Object.keys(rec);
    if (keys.length === 0) {
        log.error("Can't insert empty object into table " + table_name);
        return;
    }

    const columns = keys.join(", ");
    const questionMarks = keys.map(p => "?").join(", ");

    const query = "INSERT " + (replace ? "OR REPLACE" : "") + " INTO " + table_name + "(" + columns + ") VALUES (" + questionMarks + ")";

    const res = await execute(query, Object.values(rec));

    return res.lastID;
}

async function replace(table_name, rec) {
    return await insert(table_name, rec, true);
}

async function beginTransaction() {
    return await wrap(async db => db.run("BEGIN"));
}

async function commit() {
    return await wrap(async db => db.run("COMMIT"));
}

async function rollback() {
    return await wrap(async db => db.run("ROLLBACK"));
}

async function getRow(query, params = []) {
    return await wrap(async db => db.get(query, ...params));
}

async function getRowOrNull(query, params = []) {
    const all = await wrap(async db => db.all(query, ...params));

    return all.length > 0 ? all[0] : null;
}

async function getValue(query, params = []) {
    const row = await getRowOrNull(query, params);

    if (!row) {
        return null;
    }

    return row[Object.keys(row)[0]];
}

async function getRows(query, params = []) {
    return await wrap(async db => db.all(query, ...params));
}

async function getMap(query, params = []) {
    const map = {};
    const results = await getRows(query, params);

    for (const row of results) {
        const keys = Object.keys(row);

        map[row[keys[0]]] = row[keys[1]];
    }

    return map;
}

async function getColumn(query, params = []) {
    const list = [];
    const result = await getRows(query, params);

    if (result.length === 0) {
        return list;
    }

    const key = Object.keys(result[0])[0];

    for (const row of result) {
        list.push(row[key]);
    }

    return list;
}

async function execute(query, params = []) {
    return await wrap(async db => db.run(query, ...params));
}

async function executeScript(query) {
    return await wrap(async db => db.exec(query));
}

async function wrap(func) {
    const thisError = new Error();
    const db = await dbConnected;

    try {
        return await func(db);
    }
    catch (e) {
        log.error("Error executing query. Inner exception: " + e.stack + thisError.stack);

        thisError.message = e.stack;

        throw thisError;
    }
}

let transactionActive = false;
let transactionPromise = null;

async function doInTransaction(func) {
    while (transactionActive) {
        await transactionPromise;
    }

    let ret = null;
    const error = new Error(); // to capture correct stack trace in case of exception

    transactionActive = true;
    transactionPromise = new Promise(async (resolve, reject) => {
        try {
            await beginTransaction();

            ret = await func();

            await commit();

            transactionActive = false;
            resolve();
        }
        catch (e) {
            log.error("Error executing transaction, executing rollback. Inner exception: " + e.stack + error.stack);

            await rollback();

            transactionActive = false;

            reject(e);
        }
    });

    if (transactionActive) {
        await transactionPromise;
    }

    return ret;
}

async function isDbUpToDate() {
    let dbVersion;

    try {
        dbVersion = parseInt(await getValue("SELECT value FROM options WHERE name = 'db_version'"));
    }
    catch (e) {
        dbVersion = parseInt(await getValue("SELECT opt_value FROM options WHERE opt_name = 'db_version'"));
    }

    const upToDate = dbVersion >= app_info.db_version;

    if (!upToDate) {
        log.info("App db version is " + app_info.db_version + ", while db version is " + dbVersion + ". Migration needed.");
    }

    return upToDate;
}

async function isUserInitialized() {
    let username;

    try {
        username = await getValue("SELECT value FROM options WHERE name = 'username'");
    }
    catch (e) {
        username = await getValue("SELECT opt_value FROM options WHERE opt_name = 'username'");
    }

    return !!username;
}

module.exports = {
    dbReady,
    isUserInitialized,
    insert,
    replace,
    getValue,
    getRow,
    getRowOrNull,
    getRows,
    getMap,
    getColumn,
    execute,
    executeScript,
    doInTransaction,
    setDbReadyAsResolved,
    isDbUpToDate
};