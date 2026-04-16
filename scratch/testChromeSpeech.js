const puppeteer = require('puppeteer-core');
const os = require('os');
const path = require('path');
const fs = require('fs');

async function getChromePath() {
  const winPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  for (const p of winPaths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found');
}

async function testHeadlessRecon() {
  const chromePath = await getChromePath();
  console.log('Using Chrome:', chromePath);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false, // We'll test headful first, offscreen
    args: [
      '--use-fake-ui-for-media-stream',
      '--window-position=-2000,-2000'
    ]
  });

  const page = await browser.newPage();

  // Inject HTML content with SpeechRecognition
  const html = `
    <html>
      <body>
        <h1>Speech Test</h1>
        <script>
          const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SpeechRecognition) {
            window.speechDetected = false;
            const recognizer = new SpeechRecognition();
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.onresult = (e) => {
              window.speechDetected = true;
              console.log('TRANSCRIPT:', e.results[e.results.length-1][0].transcript);
            };
            recognizer.onerror = (e) => console.error('ERROR:', e.error);
            recognizer.start();
            console.log('Started recognition');
          } else {
            console.error('No SpeechRecognition API');
          }
        </script>
      </body>
    </html>
  `;
  
  page.on('console', msg => console.log('CHROME LOG:', msg.text()));
  
  await page.setContent(html);

  console.log('Speak into the mic for 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));
  
  const gotSpeech = await page.evaluate(() => window.speechDetected);
  console.log('Speech detected in Chrome?', gotSpeech);
  
  await browser.close();
}

testHeadlessRecon().catch(console.error);
