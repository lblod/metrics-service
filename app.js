import { app, query, errorHandler } from 'mu';
import metricProviders from './config/index';
import bodyParser from 'body-parser';
import { promises as fs } from 'fs';
import path from 'path';
import cron from 'node-cron';
import promClient from 'prom-client';

setupMetrics(metricProviders);

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  const calculatedMetrics = await Promise.all(metricProviders.map(async (m) => await m.metrics()));
  const externalMetrics = await getExternalMetrics();
  const promClientMetrics = await promClient.register.metrics();
  res.end([promClientMetrics,...calculatedMetrics, ...externalMetrics].join("\n"));
});

app.post("/delta-updates", bodyParser.json({ limit: '50mb' }), function(req, res) {
  const deltas = req.body;
  res.status(202).send('received');
  for (const provider of metricProviders) {
    try {
      if (provider.onDelta) {
        provider.onDelta(deltas);
      }
    } catch(e) {
      console.error('could not sent delta to metric provider', e);
    }
  }
});

async function getExternalMetrics() {
  const externalMetricsDir = "/external-metrics";
   try {
    const files = await fs.readdir(externalMetricsDir);
    const promFiles = files.filter((file) => file.endsWith('.prom'));
    const fileContents = await Promise.all(
      promFiles.map((file) => fs.readFile(path.join(externalMetricsDir, file), 'utf8'))
    );
    return fileContents.join('\n'); // Combine all metrics into a single string
  } catch (error) {
    console.error('Error reading external metrics:', error);
    return ''; // Return an empty string if an error occurs
  }
}

async function setupMetrics(providers) {
  for (const provider of providers) {
    try {
      if (!provider.name) throw 'Metric provider should have a descriptive name';
      if (provider.cronPattern) {
        cron.schedule(provider.cronPattern, async () => {
          try {
            await provider.cronExecute();
          } catch (e) {
            console.error(`Something went wrong while trying to execute provider ${provider.name}`, e);
          }
        });
      }
    }
    catch (e) {
      console.error('Error setting up provider', e);
      throw e;
    }
  }
}
