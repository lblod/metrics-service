# metrics service

Service providing a generic way to expose a metrics endpoint for Prometheus.

This can be done in two ways:
- providing .prom files in the `/external-metrics` mountpoint 
- providing .js files to be executed in the `/config` mountpoint

## Getting started
### Add the service to your stack
Add the following snippet in `docker-compose.yml`

```yml
services:
  metrics:
    image: lblod/metrics-service
    volumes:
      - ./config/metrics:/config
      - ./data/metrics:/external-metrics
```

Expose the `/metrics` route in `./config/dispatcher/dispatcher.ex`

```elixir
  get "/metrics", %{ layer: :api_services, accept: %{ any: true } } do
    forward conn, [], "http://metrics/metrics"
  end
```

Note: depending on the sensitivity of the metrics, you may want to protect this route with basic auth

If your metrics should be recalculated based on deltas, add the following rule to `./config/delta/rules.js`

```js
export default [
  {
    match: {
      // form of element is {subject,predicate,object}
    },
    callback: {
      url: "http://metrics/delta-updates",
      method: "POST"
    },
    options: {
      resourceFormat: "v0.0.1",
      gracePeriod: 1000,
      ignoreFromSelf: true
    }
  }
]
```

Restart `dispatcher` and `delta-notifier` and start your new service

``` shell
docker compose restart dispatcher delta-notifier
docker compose up -d metrics
```

### How-to guides
#### How to provide metrics in a *.prom file
In case you have prom files containing Prometheus metrics, just put them in `./data/metrics`. They will be automatically picked up by the `/metrics` endpoint.

All *.prom files found in `./data/metrics` will be concatenated into a single string.

#### How to create custom metrics using prom-client library
Custom metrics can be mounted in `./config/metrics`. The main entry point is `./config/metrics/index.js`. 

The service includes the [prom-client](https://github.com/siimon/prom-client) library to generate metrics. All metrics registered in prom-client's global registry are automatically exposed by the `/metrics` endpoint.

``` js
// /config/index.js
import promClient from 'prom-client';

new promClient.Gauge({
  name: 'example_random_number',
  help: 'Example metric exposing random number',

  collect() {
    const count = Math.random() * 100;
    this.set(count);
});

```

Metrics created via `promClient` are automatically registered in the global registry (and thus automatically exposed). 

The `collect()` method is executed each time the `/metrics` endpoint gets called.

#### How to create custom metrics as plain text strings
Custom metrics can be mounted in `./config/metrics`. The main entry point responsible for exporting all metric providers is `./config/metrics/index.js`. 

A custom metric provider is an object containing at least `name`. To create your own custom metric without using `prom-client` provide a `metrics()` function returning a string in Prometheus metric format.

```js
// /config/index.js

const myMetricProvider = {
  name: 'example_random_number',
  
  metrics() {
    const metricName = 'example_random_number';
    const value = Math.random() * 100;
    return `
# HELP ${metricName} Example metric exposing a random number
${metricName} ${value}
    `;
  }
}

export default [
  myMetricProvider
]
```

The `metrics()` method is executed each time the `/metrics` endpoint gets called.

#### How to execute a SPARQL query to calculate a metric
The `collect()` method of prom-client metrics as well as the `metrics()` method of a custom metric provider may be async. The `query` helper from `'mu'` can be used to execute (sudo) queries.

``` js
// /config/index.js

import promClient from 'prom-client';
import { query } from 'mu';

new promClient.Gauge({
  name: 'missing_resource_id',
  help: 'Number of resources without an id',

  async collect() {
    const result = await query(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    SELECT (COUNT(?resource) as ?count)
    FROM <http://mu.semte.ch/graphs/public>
    WHERE {
      ?resource a ?type .
      FILTER NOT EXISTS { ?resource mu:uuid ?id . }
    }`, { sudo: true });
    const count = parseInt(result.results.bindings[0]['count'].value);
    this.set(count);
  }
});
```

#### How to consume delta's to calculate a metric
Metric providers defining an `onDelta(delta)` handler will be notified by the service about new delta messages

```js
// /config/index.js

import promClient from 'prom-client';

const errorCountGauge = new promClient.Gauge({
  name: 'semtech_error_count',
  help: 'Number of errors reported in the stack'
});

const errorCountMetricsProvider = {
  name: 'error count metrics',

  onDelta(delta) {
    if (deltaIsaNewError(delta)) {
      errorCountGauge.inc();
    }
  }
}

export default [
  errorCountMetricsProvider
]
```

#### How to calculate metrics in a cron job
Metric providers defining a `cronPattern` and `cronExecute()` method will be recalculated at the provided frequency. This may for example be useful for costly calculations that don't need to be executed on each scrape of the `/metrics` endpoint.

```js
// /config/index.js

import promClient from 'prom-client';

const errorCountGauge = new promClient.Gauge({
  name: 'semtech_error_count',
  help: 'Number of errors reported in the stack'
});

const errorCountMetricsProvider = {
  name: 'error count metrics',
  cronPattern: '5 0 * * *', // each day at 0h05
  async cronExecute() {
    const count = await fetchErrorCount();
    errorCountGauge.set(count);
  }
}

export default [
  errorCountMetricsProvider
]
```
