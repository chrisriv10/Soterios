'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

module.exports = async ({ pidFile }) => {
  const childCode = 'setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ['-e', childCode], { stdio: 'ignore' });
  fs.writeFileSync(pidFile, String(child.pid), 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 10_000));
};
