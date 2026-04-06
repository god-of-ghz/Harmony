const fs = require('fs');
const json = fs.readFileSync('test_result.json', 'utf8');
const text = json.replace(/^\uFEFF/, '');
const data = JSON.parse(text);
const fails = data.testResults[0].assertionResults.filter(r => r.status === 'failed');
fails.forEach(f => {
  console.log('FAILED TEST: ', f.title);
  console.log(f.failureMessages.join('\n'));
});
