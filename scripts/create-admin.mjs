import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { randomBytes, scryptSync } from 'node:crypto';
import { db } from '../db.mjs';

function ask(prompt) {
  const io = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => io.question(prompt, (answer) => { io.close(); resolve(answer.trim()); }));
}

function askSecret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return ask(`${prompt} (input may be visible): `);
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error = null) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (key) => {
      if (key === '\u0003') return finish(new Error('Cancelled.'));
      if (key === '\r' || key === '\n') return finish();
      if (key === '\u007f' || key === '\b') { value = value.slice(0, -1); return; }
      if (key >= ' ' && key !== '\u007f') value += key;
    };
    stdin.on('data', onData);
  });
}

try {
  const username = await ask('Staff username (3 to 16 letters, numbers, or underscores): ');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('Use 3 to 16 letters, numbers, or underscores for the staff username.');
  const password = await askSecret('Staff password (12 characters minimum): ');
  if (password.length < 12 || password.length > 128) throw new Error('Use a staff password from 12 to 128 characters.');
  if (db.prepare('SELECT id FROM users WHERE minecraft_username=? COLLATE NOCASE').get(username)) throw new Error('An account already uses that username.');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  db.prepare("INSERT INTO users(minecraft_username,discord_contact,password_salt,password_hash,role) VALUES(?,'',?,?, 'admin')").run(username, salt, hash);
  console.log(`Staff account ${username} created. Sign in at /admin.`);
} finally {
  db.close();
}
