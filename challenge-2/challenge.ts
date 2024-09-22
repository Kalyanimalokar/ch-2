import { Dataset, PuppeteerCrawler } from 'crawlee';
import * as csv from 'fast-csv';
import * as fs from 'fs';
import fsExtra from 'fs-extra';

// Define the structure for storing company data
interface CompanyData {
  name: string;
  teamSize: number;
  jobCount: number;
  founders: Founder[];
  launchPostTitle: string;
  launchPostUrl: string;
}

// Define the structure for founder information
interface Founder {
  name: string;
  description: string;
}

// Path to the input CSV file and output JSON file
const CSV_PATH = './inputs/companies.csv';
const OUTPUT_PATH = './out/scraped.json';

// Function to read the CSV file and return an array of company names and URLs
async function readCSV(): Promise<{ name: string; url: string }[]> {
  return new Promise((resolve, reject) => {
    const companies: { name: string; url: string }[] = [];

    fs.createReadStream(CSV_PATH)
      .pipe(csv.parse({ headers: true }))
      .on('data', (row) => {
        // Extract the company name and URL from the CSV rows
        const name = row['Company Name'];
        const url = row['YC URL'];

        if (name && url) {
          companies.push({ name, url });
        }
      })
      .on('end', () => resolve(companies))
      .on('error', reject);
  });
}

// Main function to process the list of companies from the CSV
export async function processCompanyList() {
  try {
    const companies = await readCSV();

    const validCompanies = companies.filter((company) => company.url);

    if (validCompanies.length === 0) {
      throw new Error('No valid companies with URLs found.');
    }

    const crawler = new PuppeteerCrawler({
      async requestHandler({ page, request }) {
        const companyData: CompanyData = {
          name: '',
          teamSize: 0,
          jobCount: 0,
          founders: [],
          launchPostTitle: '',
          launchPostUrl: '',
        };

        
        await page.waitForSelector('h1');

        companyData.name = await page.$eval(
          'h1',
          (el:HTMLHeadingElement) => el.textContent?.trim() || ''
        );

        // Team size 
        companyData.teamSize = await page.evaluate(() => {
          const teamSizeDiv = Array.from(document.querySelectorAll('div')).find(
            (div) => {
              const spans = div.querySelectorAll('span');
              return (
                spans.length === 2 &&
                spans[0].textContent?.trim() === 'Team Size:'
              );
            }
          );
          if (teamSizeDiv) {
            const sizeSpan = teamSizeDiv.querySelectorAll('span')[1];
            return parseInt(sizeSpan.textContent?.trim() || '0', 10);
          }
          return 0;
        });

        // Jobs 
        companyData.jobCount = await page.evaluate(() => {
          const jobsDiv = Array.from(document.querySelectorAll('div')).find(
            (div) => {
              const anchor = div.querySelector('a');
              return anchor && anchor.textContent?.trim() === 'Jobs';
            }
          );
          if (jobsDiv) {
            const badge = jobsDiv.querySelector('.ycdc-badge');
            return badge ? parseInt(badge.textContent?.trim() || '0', 10) : 0;
          }
          return 0;
        });

        // Founders 
        companyData.founders = await page.evaluate(() => {
          const founderDivs = Array.from(
            document.querySelectorAll('div.flex-grow')
          );
          return founderDivs.reduce((founders, div) => {
            const nameEl = div.querySelector('h3');
            const descEl = div.querySelector('p');
            if (nameEl) {
              const nameText = nameEl.textContent?.trim() || '';
              if (
                nameText.toLowerCase().includes('founder') ||
                nameText.toLowerCase().includes('co-founder')
              ) {
                founders.push({
                  name: nameText,
                  description: descEl ? descEl.textContent?.trim() || '' : '',
                });
              }
            }
            return founders;
          }, [] as Founder[]);
        });

        await Dataset.pushData(companyData);
      },
    });

    // Start the crawler for each company URL
    await crawler.run(companies.map((company) => company.url));

  const dataset = await Dataset.open();
    const scrapedData = await dataset.getData();

    // Write the collected data to a JSON file
    await fsExtra.ensureDir('./out');
    await fsExtra.writeJson(OUTPUT_PATH, scrapedData.items, { spaces: 2 });
    console.log(`Data scraped and saved to ${OUTPUT_PATH}`);
  } catch (error) {
    console.error('Error processing company list:', error);
  }
}
