
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { existsSync, readFileSync } from 'node:fs';
import * as yargs from 'yargs';
import { onConfigure, onMessage } from './machine';


const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [options]')
  .example('$0 -c mqtt://localhost:1883', 'Connects to MQTT broker ready to receive a configuration paylaod.')
  .describe({
    c: 'MQTT connect URL',
    u: 'MQTT broker username',
    p: 'MQTT broker password',
    t: 'Topic',
    l: 'Log level: 0=off, 1=info',
  })
  .alias({
    c: 'url',
    u: 'username',
    p: 'password',
    t: 'topic',
    l: 'log',
  })
  .default({
    c: 'mqtt://localhost:1883',
    u: '',
    p: '',
    t: 'onoff',
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
    if (config.topic) process.env.ONOFF_TOPIC = config.topic;
    if (config.log) process.env.MQTT_ONOFF_LOG = config.log;
  } catch (error) {
    console.error('Error reading config.', error);
  }
}

const log = !!(process.env.MQTT_ONOFF_LOG || argv.l);
const url = process.env.MQTT_URL || argv.c || 'mqtt://localhost:1883';
const topic = process.env.ONOFF_TOPIC || argv.t || 'onoff';
const topicStatus = `tele/${topic}/status`;
const topicConfig = `cmnd/${topic}/configure`;

const opts:IClientOptions = {
  will: {
    topic: topicStatus,
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

mqtt.on('message', (t, payload) => {
  if (t === topicConfig) {
    if (log) console.info('Configuration received.');
    try {
      const conf = JSON.parse(payload.toString());
      onConfigure(conf, mqtt, topic, log);
    } catch (error) {
      console.error(`Ignoring invalid configuration. Reason: ${error}`);
    }
  } else {
    onMessage(t, payload, mqtt, log);
  }
});

mqtt.subscribe(topicConfig);
if (log) console.info(`Subscribed to ${topicConfig} and ready to receive a configuration.`);

// update status
mqtt.publish(topicStatus, 'Online', {retain: true});

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

