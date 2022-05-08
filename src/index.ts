
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { existsSync, readFileSync } from 'node:fs';
import * as yargs from 'yargs';
import { onConfigure, onMessage } from './machine';

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [options]')
  .example('$0 -c mqtt://localhost:1883 -t onoff_conf', 'Connects to MQTT broker and waits for configuration on the specified topic.')
  .describe({
    c: 'MQTT connect URL',
    u: 'MQTT broker username',
    p: 'MQTT broker password',
    t: 'Configuration topic',
    s: 'Status topic',
    l: 'Log level: 0=off, 1=info',
  })
  .alias({
    c: 'url',
    u: 'username',
    p: 'password',
    t: 'topic',
    s: 'stat',
    l: 'log',
  })
  .default({
    c: 'mqtt://localhost:1883',
    u: '',
    p: '',
    t: 'cmnd/onoff/configure',
    s: 'tele/onoff',
    l: 0,
  })
  .help('q')
  .alias('q', 'help')
  .parseSync();

if (existsSync('.mqtt-onoff.json')) {
  try {
    const config = JSON.parse(readFileSync('.mqtt-onoff.json').toString());
    if (config.url) process.env.MQTT_URL = config.url;
    if (config.username) process.env.MQTT_USERNAME = config.username;
    if (config.password) process.env.MQTT_PASSWORD = config.password;
    if (config.configTopic) process.env.MQTT_ONOFF_CONFIG_TOPIC = config.configTopic;
    if (config.statusTopic) process.env.MQTT_ONOFF_STATUS_TOPIC = config.statusTopic;
    if (config.log) process.env.MQTT_ONOFF_LOG = config.log;
  } catch (error) {
    console.error('Error reading config.', error);
  }
}

const log = !!(process.env.MQTT_ONOFF_LOG || argv.l);
const url = process.env.MQTT_URL || argv.c || 'mqtt://localhost:1883';
const configTopic = process.env.MQTT_ONOFF_CONFIG_TOPIC || argv.t || 'cmnd/onoff/configure';
const statusTopic = process.env.MQTT_ONOFF_STATUS_TOPIC || argv.s || 'tele/onoff/status';
const opts:IClientOptions = {
  will: {
    topic: statusTopic,
    payload: 'Offline',
    retain: true,
    qos: 0,
  }
};
if (process.env.MQTT_USERNAME || argv.u) {
  opts.username = process.env.MQTT_USERNAME || argv.u;
  if (process.env.MQTT_PASSWORD || argv.p) {
    opts.password = process.env.MQTT_PASSWORD || argv.p;
  }
}

let mqtt: MqttClient;
if (typeof url === 'string') {
  if (log) console.info(`Connecting to ${url}...`);
  mqtt = connect(url, opts);
} else {
  console.error(`Invalid MQTT broker connect URL: ${url}`);
  process.exitCode = 1;
  process.exit();
}

if (log) mqtt.on('connect', () => console.log('MQTT connected.'));

mqtt.on('message', (topic,payload) => {
  if (topic === configTopic) {
    if (log) console.info('Configuration received.');
    try {
      const conf = JSON.parse(payload.toString());
      onConfigure(conf, mqtt, log);
    } catch (error) {
      console.error(`Ignoring invalid configuration. Reason: ${error}`);
    }
  } else {
    onMessage(topic, payload, log);
  }
});

mqtt.subscribe(configTopic);
if (log) console.info(`Subscribed to ${configTopic}.`);

// update status
mqtt.publish(statusTopic, 'Online');

function endMqtt() {
  return new Promise((resolve,reject) => {
    mqtt.end(false, {}, err => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

async function shutdown() {
  try {
    await endMqtt();
  } catch (er) {
    console.error(er);
    process.exitCode = 1;
  }
  process.exit();
}

process.on('SIGINT', async function onSigint () {
  console.info('Shutting down ', new Date().toISOString());
  await shutdown();
});

process.on('SIGTERM', async function onSigterm () {
  console.info('Shutting down ', new Date().toISOString());
  await shutdown();
});

