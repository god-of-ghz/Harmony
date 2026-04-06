const sqlite3 = require('sqlite3');
const path = require('path');

async function dump(subdir) {
    const dbPath = path.resolve(process.cwd(), subdir, 'node_3099.db');
    const db = new sqlite3.Database(dbPath);
    
    db.all("SELECT * FROM accounts", (err, rows) => {
        if (err) {
            console.error(`ERROR IN ${subdir}:`, err);
        } else {
            console.log(`ACCOUNTS FOUND IN ${subdir}:`, rows.length);
            rows.forEach(r => console.log(` - ID: ${r.id}, Email: ${r.email}, is_creator: ${r.is_creator}, is_admin: ${r.is_admin}`));
        }
        db.close();
    });
}
dump('data_mock');
dump('data');
