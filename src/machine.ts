
import { MqttClient } from 'mqtt';
import type { BinaryValue, Direction, Edge, Options } from 'onoff';
import { Gpio } from 'onoff';

export interface IPin {
  topic: string;
  gpio: number;
  direction: Direction | 'watch';
  edge?: Edge;
  options?: Options;
}
export interface IConfig {
  topicPrefix?: string;
  pins: IPin[];
}
export interface ISubscription {
  topic: string;
  topicSub: string;
  topicPub: string;
  topicErr: string;
  gpio: number;
  io: Gpio | null;
  direction: Direction | 'watch';
  prevWatchValue?: BinaryValue;
}

const pad = (n:number) => n > 9 ? n.toString() : ` ${n}`;

const subscriptions = new Map<number, ISubscription>();

const getSubCount = () => subscriptions.size;

const configPin = (pin:IPin, mqtt:MqttClient, appTopic: string, log = false) => {
  let sub: ISubscription;
  if (subscriptions.has(pin.gpio)) {
    if (log) console.info(`Recycling previously configured GPIO ${pin.gpio}`);
    //clean up
    sub = subscriptions.get(pin.gpio) as ISubscription;
    mqtt.unsubscribe(sub.topicSub);
    if (sub.direction === 'watch') sub.io?.unwatch();
    subscriptions.delete(pin.gpio);
  }

  // set up
  sub = {
    gpio: pin.gpio,
    topic: pin.topic,
    topicPub: `tele/${appTopic}/${pin.topic}`,
    topicSub: `cmnd/${appTopic}/${pin.topic}`,
    topicErr: `tele/${appTopic}/error/${pin.topic}`,
    direction: pin.direction,
    io: Gpio.accessible ? new Gpio(pin.gpio, pin.direction === 'watch' ? 'in' : pin.direction, pin.edge, pin.options) : null
  };
  if (pin.direction === 'watch' || pin.direction === 'in') {
    if (pin.direction === 'watch') sub.io?.watch((err, value) => {
      if (err) {
        try {
          mqtt.publish(sub.topicErr, JSON.stringify({ ...err, description:`GPIO ${sub.gpio} watch failed` }));
        } catch (error) {
          console.error(`[!] Failed to watch payload of ${sub.topic} from gpio ${sub.gpio} (due to ${err}) and failed to publish it to MQTT (due to ${error}).`);
        }
      } else {
        if (value === sub?.prevWatchValue) return; // my circuit could be causing these OFF values when I remotely switch a light on
        if (sub) sub.prevWatchValue = value;
        if (log) console.info(`${value ? '[ON] ' : '[OFF]'} ${pad(sub.gpio)} -> ${sub.topicPub}.`);
        mqtt.publish(sub.topicPub, value.toString());
      }
    });
    if (log) console.info(`Input ${pad(sub.gpio)} -> ${sub.topicPub} (${pin.direction === 'watch' ? '' : 'NO '}WATCH). R.O.D.: ${sub.topicSub}.`);
  } else {
    if (log) console.info(`Output ${pad(sub.gpio)} <- ${sub.topicSub}. Ack. to ${sub.topicPub}`);
  }
  mqtt.subscribe(sub.topicSub);
  subscriptions.set(sub.gpio, sub);
};

export function onConfigure(conf:IConfig|IPin, mqtt:MqttClient, appTopic:string, log = false) {
  if ('pins' in conf) { // all pins
    const pins = conf.pins;
    if (log) console.info(`Configuring ${pins.length} pins...`);
    pins.forEach(pin => configPin(pin, mqtt, appTopic, log));
    mqtt.publish(`tele/${appTopic}/configured`, JSON.stringify({pins: getSubCount()}), {retain: true});
    if (log) console.info(`Completed configuration of ${pins.length} pins.`);
  } else if ('gpio' in conf && 'direction' in conf) { // individual pin
    configPin(conf, mqtt, appTopic, log);
  }
}

export function onMessage(topic:string, payload:Buffer, mqtt:MqttClient, log = false) {
  subscriptions.forEach((sub) => {
    if (sub.topicSub !== topic) return;
    if (sub.direction === 'watch' || sub.direction === 'in') {
      // READ ON DEMAND
      sub.io?.read((err, value) => {
        if (err) {
          try {
            mqtt.publish(sub.topicErr, JSON.stringify({ ...err, description:`GPIO ${sub.gpio} read failed` }));
          } catch (error) {
            console.error(`[!] Failed to read payload of ${sub.topic} from gpio ${sub.gpio} (due to ${err}) and failed to publish it to MQTT (due to ${error}).`);
          }
        } else {
          if (log) console.info(`${value ? '[ON] ' : '[OFF]'} ${pad(sub.gpio)} -> ${sub.topicPub}. (R.O.D.)`);
          mqtt.publish(sub.topicPub, value.toString());
        }
      });
    } else {
      // 
      const s = payload.toString().toLowerCase();
      const value:BinaryValue = s === '1' || s === 'on' || s === 'true' ? 1 : 0;
      if (log) console.info(`${value ? '[ON] ' : '[OFF]'} ${pad(sub.gpio)} <- ${sub.topicPub}`);
      sub.io?.write(value, (err) => {
        if (err) {
          try {
            mqtt.publish(sub.topicErr, JSON.stringify({ ...err, description:`GPIO ${sub.gpio} write failed` }));
          } catch (error) {
            console.error(`[!] Failed to write payload of ${sub.topic} to gpio ${sub.gpio} (due to ${err}) and failed to publish it to MQTT (due to ${error}).`);
          }
        } else {
          mqtt.publish(sub.topicPub, value.toString());
        }
      });
    }
  });
}