import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';
async function test() {
    const token = jwt.sign({ accountId: 'dummy' }, JWT_SECRET);
    const res = await fetch('http://localhost:3001/api/servers/305208823793057803/profiles', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const text = await res.text();
    console.log(text.substring(0, 1000));
}
test();
