import { parseAirbnbUrl } from './airbnb.js';
import { runListingJob } from './engine.js';

const input = process.argv[2];
const airbnb = input ? parseAirbnbUrl(input) : null;

runListingJob({
  airbnbUrl: airbnb?.listingUrl,
  photoDir: airbnb ? undefined : input,
  log: true,
})
  .then(() => {
    console.log('\nFicha lista. App: node server.js  →  http://localhost:3456');
  })
  .catch((error) => {
    console.error('\nError:', error.message);
    process.exit(1);
  });
