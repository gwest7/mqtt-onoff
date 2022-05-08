
import { MqttClient } from 'mqtt';
import type { BinaryValue, Direction, Edge, Options } from 'onoff';
import { Gpio } from 'onoff';

export interface IConfig {
  topicPrefix?: string;
  pins: {
    gpio: number;
    direction: Direction;
    edge?: Edge;
    options?: Options;
    topic?: string;
  }[];
}
export interface ISubscription {
  gpio: number;
  topic: string;
  subscribed?: boolean;
  io: Gpio | null;
  watching?: boolean;
}

const subscriptions:Map<number, ISubscription> = new Map();

export function onConfigure(conf:IConfig, mqtt:MqttClient, log = false) {
  // clean the previous subscriptions
  if (subscriptions.size && log) {
    console.info(`Clearing previous ${subscriptions.size} gpio configurations`);
    subscriptions.forEach(sub => {
      if (sub.topic && sub.subscribed) {
        mqtt.unsubscribe(sub.topic);
        sub.subscribed = false;
      }
      if (sub.io && sub.watching) {
        sub.io.unwatch();
        sub.watching = false;
      }
    });
    subscriptions.clear();
  }

  // setup new subscriptions
  const prefix = conf.topicPrefix ?? 'onoff';
  conf.pins.forEach(pin => {
    let sub = subscriptions.get(pin.gpio);
    const io = Gpio.accessible ? new Gpio(pin.gpio, pin.direction, pin.edge, pin.options) : null;
    const topic = pin.topic ?? `${prefix}/${pin.direction}/${pin.gpio}`;
    if (sub) {
      if (log) console.warn(`Ignoring duplicate configuration for gpio ${pin.gpio} (${pin.direction}).`);
      return;
    } else {
      sub = { gpio:pin.gpio, topic, io };
      subscriptions.set(pin.gpio, sub);
    }
    if (pin.direction === 'in') {
      // TODO: as alternative to `watch` add a subscription for reading queues 
      io?.watch((err, value) => {
        if (err) {
          console.error(`Gpio ${pin.gpio} watch failed. ${err}`);
          // TODO publish error
        } else {
          if (log) console.info(`Publishing value of gpio ${pin.gpio} (${value ? 'ON' : 'OFF'}) to ${topic}`);
          mqtt.publish(topic, value.toString());
        }
      });
      sub.watching = true;
      if (log) console.info(`Watching gpio ${pin.gpio} -> ${topic}`);
    } else {
      mqtt.subscribe(topic);
      sub.subscribed = true;
      if (log) console.info(`Ready to write to gpio ${pin.gpio} <- ${topic}`);
    }
  });
  if (log) console.info(`Configuration completed with ${subscriptions.size} pins.`);
  return prefix;
}

export function onMessage(topic:string, payload:Buffer, log = false) {
  subscriptions.forEach((sub) => {
    if (sub.topic !== topic) return;
    const s = payload.toString().toLowerCase();
    const value:BinaryValue = s === '1' || s === 'on' || s === 'true' ? 1 : 0;
    if (log) console.info(`Writing payload (${value ? 'ON' : 'OFF'}) of ${topic} to gpio ${sub.gpio}...`);
    sub.io?.write(value, (err) => {
      if (err) {
        console.error(`Failed to write payload of ${topic} to gpio ${sub.gpio}. ${err}`);
        //TODO: publish error
      } else {
        if (log) console.info(`Wrote payload of ${topic} to gpio ${sub.gpio}.`);
        // TODO: publish confirmation
      }
    });
  });
}