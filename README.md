# metrics service

The goal of this service is to provide a generic way for an application to expose a metrics endpoint for prometheus.
This can be done in two ways:
- providing .prom files in the `/external-metrics` mountpoint 
- providing .js files to be executed in the `/config` mountpoint


## Add the service to your stack
### docker-compose.yml
```yml
services:
  metrics:
    image: lblod/metrics
    volumes:
      - ./data/metrics:/external-metrics
      - ./config/metrics:/config
```
### expose metrics
Note: depending on the sensitivity of the metrics, you may want to protect this route with basic auth
```ex
  #################
  # prometheus reporting
  #################
  get "/metrics", %{ layer: :api_services, accept: %{ any: true } } do
    Proxy.forward conn, [], "http://metrics/metrics"
  end
```

### delta notifier hooks (if necessary)
```js
export default [
  {
    match: {
      // form of element is {subject,predicate,object}
      // predicate: { type: "uri", value: "http://www.semanticdesktop.org/ontologies/2007/03/22/nmo#isPartOf" }
    },
    callback: {
      url: "http://metrics/delta-updates", method: "POST"
    },
    options: {
      resourceFormat: "v0.0.1",
      gracePeriod: 1000,
      ignoreFromSelf: true
    }
  }
]
```
## Defining metrics

### index.js
The index file is responsible of exporting all metrics to be executed.
For example:
```js
import ErrorReport from './error-report';
export default [ ErrorReport ]
```

### Metrics
This service includes the [prom-client](https://github.com/siimon/prom-client) library to generate metrics and [mu-auth-sudo](https://github.com/lblod/mu-auth-sudo/tree/v1.0.0-beta.4) for sudo queries. An example metric config:

```js
import promClient from 'prom-client';

const jobStatusGuage = new promClient.Gauge({
  name: 'semtech_error_count',
  help: 'errors reported in the stack',
});

const register = promClient.register;


export default {
  name: 'job statuses',
  cronPattern: '5 0 * * *', // optional
  async onDelta(delta) { // optional
    if (deltaIsaNewError(delta)) {
      errorGauge.inc();
    }
  },
  async cronExecute() { // optional
    const errorCount = await fetchErrorCount();
    errorGauge.set(errorCount);
  },
  async metrics() {
    // return metrics here if you do not use the global promClient register
  }
}
```

