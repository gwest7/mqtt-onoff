

Bridge between [mqtt](https://www.npmjs.com/package/mqtt) and [onoff](https://www.npmjs.com/package/onoff).

```bash
Usage: mqtt-onoff [options]

Options:
  -c, --url <value>       connect URL (default: mqtt://localhost:1883)
  -u, --username <value>  MQTT broker username (optional)
  -p, --password <value>  MQTT broker password (optional)
  -t, --topic <value>     MQTT topic (default: onoff)
  -l, --log <value>       extra logging for socket connection issues
```

Environment variables may be used instead:
`MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC` and `MQTT_ONOFF_LOG`.

A config file named `.mqtt-onoff.json` may also be used.
```js
{
  "url": "mqtt://localhost:1883",
  "username": "system",
  "password": "***",
  "topic": "onoff/device1",
  "log": 1
}
```

# Configure

Pins are configured by publishing to the topic `cmnd/[topic]/configure`.

Configuration payload needs to be a JSON string in the following format:
```js
{
  "pins": [
    {
      "topic": "doorbel", // used to compose the MQTT topic
      "gpio": 22, // onoff gpio
      "direction": "in", // onoff direction
      "edge": "none", // onoff edge
      "options": {} // onoff options
    }
  ]
}
```
More info about these properties can be found [here](https://www.npmjs.com/package/onoff#api).

At any time individual pins can be configured by publishing a JSON string the following format:
```js
{
  "topic": "doorbel",
  "gpio": 22,
  "direction": "out"
}
```

## Inputs (`direction: "in"`)

An `onoff` `read` can be done by publishing any payload (eg. `""`) to `cmnd/[topic]/[pin.topic]`. This will publish the input value to `tele/[topic]/[pin.topic]`.

In the logs this is refered to as an `R.O.D.` (read on deamand).

## Watch inputs (`direction: "watch"`)

When the onoff pin is configured an `in` direction is used. However within `mqtt-onoff` an `onoff` `watch` is setup and values are published to `tele/[topic]/[pin.topic]`.

An `R.O.D` can also be done on these pins.

## Outputs (`direction: "out" | "high" | "low"`)

Publishing `"0"` or `"1"` to `cmnd/[topic]/[pin.topic]` will result in an `onoff` `write`. A successful write is acknowledged by the payload being published to `tele/[topic]/[pin.topic]`.

