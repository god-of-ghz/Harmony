import dbManager from './database';

const email = process.argv[2];

if (!email) {
    console.error("Usage: npm run elevate <email>");
    process.exit(1);
}

const elevate = async () => {
    try {
        await dbManager.runNodeQuery('UPDATE accounts SET is_creator = 1, is_admin = 1 WHERE email = ?', [email]);
        console.log(`Successfully elevated ${email} to GLOBAL CREATOR and ADMIN.`);
    } catch (e) {
        console.error(e);
    }
};

setTimeout(elevate, 500);
