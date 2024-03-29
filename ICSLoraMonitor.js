//'use strict';

/*
  ______ _       _______     _______
 |  ____| |     / ____\ \   / / ____|
 | |__  | |    | (___  \ \_/ / (___  
 |  __| | |     \___ \  \   / \___ \
 | |____| |____ ____) |  | |  ____) |
 |______|______|_____/   |_| |_____/
 
  ELSYS simple payload decoder.
  Use it as it is or remove the bugs :)
  www.elsys.se
  peter@elsys.se
*/

const CollectorName = "LoraMonitor v. 1.10";
const CollectorVersionDate = "31 Jan 2022";
console.log("Hello! Starting " + CollectorName + " at " + Date());

const W3CWebSocket = require('websocket').w3cwebsocket;
const Publisher = require('./ICSpublish.js');

// read options
const readConfig = require('./config.js').readConfig;
const opts = readConfig(process.argv[2]);

const iot = new Publisher(opts);

const wsAddress = "ws://" + opts.loraserver.host + ":" + opts.loraserver.port;
const outgoingMessage = '{ "cmd": "auth_req", "login": "root", "password": "' + opts.loraserver.password + '" }';
console.log('Opening Lora Server WebSocket...');
const wsConfig = {
    keepalive: true,
    useNativeKeepalive: true,
    keepaliveInterval: opts.loraserver.keepaliveInterval
}
const socket = new W3CWebSocket(wsAddress,undefined,undefined,undefined,undefined,wsConfig);
//console.log(socket);

socket.onopen = function() {
    console.log("connection opened");
    socket.send(outgoingMessage);
    setInterval( datacheck, opts.loraserver.datacheckinterval * (opts.loraserver.datacheckintervalunit=='s'?1000:1) );
    };
//console.log("Collecting response...");

// обработчик входящих сообщений
var endmoment = + new Date();
socket.onmessage = function(event) {
    //  console.log("Got: "+event.data);
    endmoment = + new Date();
    var msg = JSON.parse(event.data);
    if ((msg.type == "UNCONF_UP") || (msg.type == "CONF_UP")) {
        //console.log("Got: "+msg.data+' from '+msg.devEui+', type='+msg.type);
        switch (getType(msg.devEui)) {
            case 'Elsys':
                var sensordata = DecodeElsysPayload(hexToBytes(msg.data));
                break;
            case 'VegaTD11':
                var sensordata = DecodeVegaTD11Payload(Buffer.from(msg.data,'hex'));
                break;
            case 'VegaSmartUM':
                var sensordata = DecodeVegaSmartUM(Buffer.from(msg.data,'hex'));
                break;
            case 'what?':
                doError({error:"ERROR", message:"ICSLoraMonitor.js: I dunno type of that devEUI"});
                break;
        }

        if ( sensordata === null ) {
            doError(eRESPONSE, 'decoder return null', {buffer:event.data, data:msg});
            return;
            }
        if ( sensordata.error ) {
            doError(sensordata);
            return;
            }
    
        sensordata.devEui = msg.devEui;
        iot.sendevent(opts.iotservers, msg.devEui, sensordata);
        }
    return false;
    };

// check data income
var dcheck_interval = opts.loraserver.datacheckinterval * (opts.loraserver.datacheckintervalunit=='s'?1000:1);
function datacheck(){
    if ( (+new Date()) - endmoment > dcheck_interval ){
        doError({error:"ERROR", message:"client doesn't send packets more than " + (dcheck_interval/1000).toFixed(2) + 'sec'});
        process.emit('SIGTERM');
        }
    }



const TYPE_TEMP = 0x01; //temp 2 bytes -3276.8°C -->3276.7°C
const TYPE_RH = 0x02; //Humidity 1 byte  0-100%
const TYPE_ACC = 0x03; //acceleration 3 bytes X,Y,Z -128 --> 127 +/-63=1G
const TYPE_LIGHT = 0x04; //Light 2 bytes 0-->65535 Lux
const TYPE_MOTION = 0x05; //No of motion 1 byte  0-255
const TYPE_CO2 = 0x06; //Co2 2 bytes 0-65535 ppm
const TYPE_VDD = 0x07; //VDD 2byte 0-65535mV
const TYPE_ANALOG1 = 0x08; //VDD 2byte 0-65535mV
const TYPE_GPS = 0x09; //3bytes lat 3bytes long binary
const TYPE_PULSE1 = 0x0A; //2bytes relative pulse count
const TYPE_PULSE1_ABS = 0x0B; //4bytes no 0->0xFFFFFFFF
const TYPE_EXT_TEMP1 = 0x0C; //2bytes -3276.5C-->3276.5C
const TYPE_EXT_DIGITAL = 0x0D; //1bytes value 1 or 0
const TYPE_EXT_DISTANCE = 0x0E; //2bytes distance in mm
const TYPE_ACC_MOTION = 0x0F; //1byte number of vibration/motion
const TYPE_IR_TEMP = 0x10; //2bytes internal temp 2bytes external temp -3276.5C-->3276.5C
const TYPE_OCCUPANCY = 0x11; //1byte data
const TYPE_WATERLEAK = 0x12; //1byte data 0-255
const TYPE_GRIDEYE = 0x13; //65byte temperature data 1byte ref+64byte external temp
const TYPE_PRESSURE = 0x14; //4byte pressure data (hPa)
const TYPE_SOUND = 0x15; //2byte sound data (peak/avg)
const TYPE_PULSE2 = 0x16; //2bytes 0-->0xFFFF
const TYPE_PULSE2_ABS = 0x17; //4bytes no 0->0xFFFFFFFF
const TYPE_ANALOG2 = 0x18; //2bytes voltage in mV
const TYPE_EXT_TEMP2 = 0x19; //2bytes -3276.5C-->3276.5C

function getType(devEui) {
    if (devEui[0] == "A") {
        return 'Elsys';
        } 
    else if (devEui.substring(0,2) == '37') {
        return 'VegaTD11';
        } 
    else if ( devEui.substring(0,2) == '38' ){
        return 'VegaSmartUM';
        } 
    else {
        return 'what?'
        }
    }

function bin16dec(bin) {
    var num = bin & 0xFFFF;
    if (0x8000 & num)
        num = -(0x010000 - num);
    return num;
}

function bin8dec(bin) {
    var num = bin & 0xFF;
    if (0x80 & num)
        num = -(0x0100 - num);
    return num;
}

function hexToBytes(hex) {
    for (var bytes = [], c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return bytes;
}

function DecodeElsysPayload(data) {
    var obj = new Object();
    //showMessage("Decoding "+data);
    for (i = 0; i < data.length; i++) {
        switch (data[i]) {
            case TYPE_TEMP: //Temperature
                var temp = (data[i + 1] << 8) | (data[i + 2]);
                temp = bin16dec(temp);
                obj.temperature = temp / 10;
                i += 2;
                break
            case TYPE_RH: //Humidity
                let rh = (data[i + 1]);
                obj.humidity = rh;
                i += 1;
                break
            case TYPE_ACC: //Acceleration
                obj.x = bin8dec(data[i + 1]);
                obj.y = bin8dec(data[i + 2]);
                obj.z = bin8dec(data[i + 3]);
                i += 3;
                break
            case TYPE_LIGHT: //Light
                obj.light = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_MOTION: //Motion sensor(PIR)
                obj.motion = (data[i + 1]);
                i += 1;
                break
            case TYPE_CO2: //CO2
                obj.co2 = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_VDD: //Battery level
                obj.vdd = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_ANALOG1: //Analog input 1
                obj.analog1 = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_GPS: //gps
                obj.lat = (data[i + 1] << 16) | (data[i + 2] << 8) | (data[i + 3]);
                obj.long = (data[i + 4] << 16) | (data[i + 5] << 8) | (data[i + 6]);
                i += 6;
                break
            case TYPE_PULSE1: //Pulse input 1
                obj.pulse1 = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_PULSE1_ABS: //Pulse input 1 absolute value
                let pulseAbs = (data[i + 1] << 24) | (data[i + 2] << 16) | (data[i + 3] << 8) | (data[i + 4]);
                obj.pulseAbs = pulseAbs;
                i += 4;
                break
            case TYPE_EXT_TEMP1: //External temp
                var temp = (data[i + 1] << 8) | (data[i + 2]);
                temp = bin16dec(temp);
                obj.externalTemperature = temp / 10;
                i += 2;
                break
            case TYPE_EXT_DIGITAL: //Digital input
                obj.digital = (data[i + 1]);
                i += 1;
                break
            case TYPE_EXT_DISTANCE: //Distance sensor input
                obj.distance = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_ACC_MOTION: //Acc motion
                obj.accMotion = (data[i + 1]);
                i += 1;
                break
            case TYPE_IR_TEMP: //IR temperature
                let iTemp = (data[i + 1] << 8) | (data[i + 2]);
                iTemp = bin16dec(iTemp);
                let eTemp = (data[i + 3] << 8) | (data[i + 4]);
                eTemp = bin16dec(eTemp);
                obj.irInternalTemperature = iTemp / 10;
                obj.irExternalTemperature = eTemp / 10;
                i += 4;
                break
            case TYPE_OCCUPANCY: //Body occupancy
                obj.occupancy = (data[i + 1]);
                i += 1;
                break
            case TYPE_WATERLEAK: //Water leak
                obj.waterleak = (data[i + 1]);
                i += 1;
                break
            case TYPE_GRIDEYE: //Grideye data
                i += 65;
                break
            case TYPE_PRESSURE: //External Pressure
                var temp = (data[i + 1] << 24) | (data[i + 2] << 16) | (data[i + 3] << 8) | (data[i + 4]);
                obj.pressure = temp / 1000;
                i += 4;
                break
            case TYPE_SOUND: //Sound
                obj.soundPeak = data[i + 1];
                obj.soundAvg = data[i + 2];
                i += 2;
                break
            case TYPE_PULSE2: //Pulse 2
                obj.pulse2 = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_PULSE2_ABS: //Pulse input 2 absolute value
                obj.pulseAbs2 = (data[i + 1] << 24) | (data[i + 2] << 16) | (data[i + 3] << 8) | (data[i + 4]);
                i += 4;
                break
            case TYPE_ANALOG2: //Analog input 2
                obj.analog2 = (data[i + 1] << 8) | (data[i + 2]);
                i += 2;
                break
            case TYPE_EXT_TEMP2: //External temp 2
                var temp = (data[i + 1] << 8) | (data[i + 2]);
                temp = bin16dec(temp);
                obj.externalTemperature2 = temp / 10;
                i += 2;
                break
            default: //somthing is wrong with data
                i = data.length;
                break
        }
    }
    var ret = {ts: +new Date(), values: obj};
    return ret;
}

function DecodeVegaPayload(data) {
    var obj = new Object();
    obj.type = data[0];
    obj.charge = data[1];
    if (data[2] & 0x01 == 0) {
        obj.activation = "OTAA";
    } else {
        obj.activation = "ABP";
    };
    if ((data[2] >> 1) & 0x01 == 0) {
        obj.ack = false;
    } else {
        obj.ack = true;
    };
    switch ((data[2] >> 2) & 0x03) {
        case 0:
            obj.period = 3600;
            break
        case 1:
            obj.period = 6 * 3600;
            break
        case 2:
            obj.period = 12 * 3600;
            break
        case 3:
            obj.period = 24 * 3600;
    };
    obj.temperature = ((data[4] << 8) | (data[3])) / 10;
    switch (data[5]) {
        case 0:
            obj.reason = "Time";
            break
        case 1:
            obj.reason = "Security";
            break
        case 2:
            obj.reason = "Open";
            break
        case 3:
            obj.reason = "HallDev1";
            break
        case 4:
            obj.reason = "HallDev2";
    };
    obj.security = (data[6]) & 0x01;
    obj.open = (data[6] >> 1) & 0x01;
    obj.halldev1 = (data[6] >> 2) & 0x01;
    obj.halldev2 = (data[6] >> 3) & 0x01;

    var ret = {ts: +new Date(), values: obj};
    return ret;
    };

function DecodeVegaTD11Payload(buf) {
    if( buf.length < 13 ) return sayError(eLENGTH,'buffer.length < 13', {bufer:buf.toString('hex')});
    var obj = {
        charge: buf.readUInt8(1),
        limitexceed: buf.readUInt8(2),
        time: buf.readUInt32LE(3),
        temperature: buf.readInt16LE(7) / 10,
        mintemperature: buf.readInt8(9),
        maxtemperature: buf.readInt8(10),
        reason: buf.readUInt8(11),
        inputstate: buf.readUInt8(12)
        };
    var ret = {ts: +new Date(), values: obj};
    return ret;
    };

const VegaSmartUM_types = ['','normal','co2_out',
                    'illumination_out','accelerometer','humidity_out',
                    'temperature_out','noise_out','removing_fact'];
function DecodeVegaSmartUM(buf) {
    let type = buf.readUInt8(0);
    if ( type == 255 )
        return sayError(eERROR,'Smart UM request time corrections',{bufer:buf.toString('hex')});
    if ( type == 0 )
        return sayError(eERROR,'Smart UM send settings',{bufer:buf.toString('hex')});

    if( buf.length < 13 ) return sayError(eLENGTH,'buffer.length < 13', {bufer:buf.toString('hex')});
    var obj = {
        type: VegaSmartUM_types[buf.readUInt8(0)],
        charge: buf.readUInt8(1),
        timestamp: buf.readUInt32LE(2),
        powerstate: buf.readUInt8(6),
        temperature: buf.readInt16LE(7) / 10,
        humidity: buf.readUInt8(9),
        illumination: buf.readUInt16LE(10),
        noise: buf.readUInt8(12)        
        };
    if( buf.length >= 15 )
        { obj.co2 = buf.readUInt16LE(13); }
    if( buf.length >= 16 )
        { obj.anglevertical = buf.readUInt8(15); }


    var ret = {ts: obj.timestamp*1000, values: obj};
    let curtime = +new Date();
    if( Math.abs( ret.ts - curtime ) > 2592000000 /*30days*/ ){
        ret.ts = curtime;
    }

    //console.log('VegaSmartUM says: '+ JSON.stringify(ret));
    return ret;
    };
    
// LoRa


socket.onerror = function() {
    console.log('Connection Error. Stop');
    process.exit();
    };

socket.onclose = function() {
    console.log('websocket Closed. Stop');
    process.exit();
    };


const eERROR = Symbol.for('ERROR'), eLENGTH = Symbol.for('LENGTH'), eRESPONSE = Symbol.for('RESPONSE');
const errors_msg = {
    [eERROR]: 'Some error', 
    [eLENGTH]: 'RECEIVED bad length of data',
    [eRESPONSE]: 'RECEIVED BAD response'
    };
function sayError(err, str, obj) {
    return {
            error: err, 
            message: str ?? errors_msg[err] ?? errors_msg[eERROR],
            data: obj
        };
    }

async function doError(errdata) {
    console.log('ERROR: ' + errdata.error?.toString() + ' . ' + errdata.message);
    if( errdata.data ) console.log('Data: ' + JSON.stringify(errdata.data, null, 2) );
    }    
    
