import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./data/node.db');
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) console.error(err);
    else console.log("TABLES:", rows);
});
