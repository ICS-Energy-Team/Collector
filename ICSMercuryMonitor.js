//'use strict';

/*
  Mercury 234 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "MercuryMonitor v. 1.4";
const moment = require('moment');
console.log("Hello! Starting " + CollectorName + " at " + moment().format("DD MMM YYYY, HH:mm:ss"));

const net = require('net');
const crc16 = require('crc').crc16modbus;

var iot = require('./ICSpublish.js');

var opts;// = require('./'+process.argv[2]);
function readOptions () {
  opts = require('./'+process.argv[2]);
  // need static options check
}
readOptions();
if ( opts.moxa.Mercury206 ) {
  const Merc206 = require('./Mercury206parser');
  var merc206 = new Merc206(opts.moxa.Mercury206);
  merc206.prepare();
  }

// MOXA

var runningcommand = -1;
var runningdevice = 0;
var DeviceIDs = [], newDeviceIDs;
var RequestedDevices = [];

var client = new net.Socket();
const ClientStates = {
    SLEEP: -1,
    NOT_CONNECTED: 0,
    CONNECTED: 1,
    DEVICES_SEARCH: 2,
    DEVICES_REQUEST: 3
};
const ClientSubStates = { BASE: 0, LONGSEARCH: 1, MERC206: 2 };
const ClientEvents = {
    TRY_TO_RUN: 1000,
    CONNECT_SUCCESS: 1001,
    LOST_CONNECTION: 1002,
    DEVICES_FOUND: 1003,
    DEVICES_START_REQUEST: 1004
};
const MIN_DEVICE_ID = 1, MAX_DEVICE_ID = 240;
var searchdevicecounter, longsearchdevcnt;
var stateInterval, dataInterval;
var clientState = ClientStates.SLEEP, stateChanged = false, subState = ClientSubStates.BASE;
function setState(newstate) {
    stateChanged = clientState != newstate;
    clientState = newstate;
}
setState(ClientStates.NOT_CONNECTED);
stateClientMOXA();

async function stateClientMOXA(newevent) {
    switch (clientState) {
    case ClientStates.NOT_CONNECTED :
          if( newevent == ClientEvents.CONNECT_SUCCESS ) {
              clearInterval(stateInterval);
              setState(ClientStates.DEVICES_SEARCH);
              return stateClientMOXA();//stateInterval = setInterval(stateClientMOXA,10);
          }
          if( stateChanged ){
              stateChanged = false;
              clearInterval(stateInterval);
              stateInterval = setInterval(stateClientMOXA,5000/*each 5sec try to connect*/);
              }
          connect();
          break;
    case ClientStates.DEVICES_SEARCH :
          if( newevent == ClientEvents.LOST_CONNECTION ) {
              clearInterval(stateInterval);
              setState(ClientStates.NOT_CONNECTED);
              return stateClientMOXA();
              }
          else if( newevent == ClientEvents.DEVICES_FOUND || searchdevicecounter > MAX_DEVICE_ID ) {
              clearInterval(stateInterval);
              DeviceIDs = [...new Set(newDeviceIDs)]; // get only unique IDs
              console.log("Found "+DeviceIDs.length+" devices: "+DeviceIDs);
              setState(ClientStates.DEVICES_REQUEST);
              return stateClientMOXA();
              }
          // fill the device list by trying to admin connect to each device with interval opts.moxa.delay1
          // loop all possible device ids
          if( stateChanged ) {
              stateChanged = false;
              DeviceIDs = []; newDeviceIDs = [];
              searchdevicecounter = MIN_DEVICE_ID;
              clearInterval(stateInterval);
              stateInterval = setInterval(stateClientMOXA,opts.moxa.Mercury234.searchdelay);
              }
          ask(searchdevicecounter);
          searchdevicecounter++;
          break;
    case ClientStates.DEVICES_REQUEST :
          clearInterval(stateInterval);
          if( newevent == ClientEvents.LOST_CONNECTION ){
              clearInterval(dataInterval);
              setState(ClientStates.NOT_CONNECTED);
              return stateClientMOXA();
              }
          if( newevent == ClientEvents.DEVICES_START_REQUEST || stateChanged ){
              subState = ClientSubStates.BASE;
              if( stateChanged ) {
                  stateChanged = false;
                  longsearchdevcnt = MIN_DEVICE_ID;
                  // запрос данных каждые opts.moxa.datainterval мс
                  dataInterval = setInterval(stateClientMOXA, opts.moxa.datainterval, ClientEvents.DEVICES_START_REQUEST);
                  }
              if( RequestedDevices.length == DeviceIDs.length ){
                  sayError(ERROR,"All devices doesn't respond, close connection, end");
                  process.emit('SIGTERM');
                  return;
                  }
              else if( RequestedDevices.length ) {
                  sayLog(LOG,'not responsed RequestedDevices: ' + RequestedDevices + ', all:' + DeviceIDs);
                  }
              RequestedDevices = [];
              runningdevice = 0;
              runningcommand = 0;
              console.log('REQUEST ALL ' + DeviceIDs.length + ' DEVICES: ' + DeviceIDs);
              }
          if ( subState == ClientSubStates.BASE ) {
              if ( runningdevice >= DeviceIDs.length ) {
                subState = ClientSubStates.LONGSEARCH;
                newDeviceIDs = [];
                if ( longsearchdevcnt > MAX_DEVICE_ID ) longsearchdevcnt = MIN_DEVICE_ID;
                sayLog(0,"ASK "+longsearchdevcnt);
                ask(longsearchdevcnt);
                longsearchdevcnt++;
                stateInterval = setInterval(stateClientMOXA,opts.moxa.Mercury234.searchdelay);
                return;
                }
              requestdata(runningdevice,runningcommand);
              stateInterval = setInterval(stateClientMOXA, cmdtimeouts[runningcommand]);
              runningdevice++;
              }
          else if( subState == ClientSubStates.LONGSEARCH ){
              /*if ( newDeviceIDs.length == 0 ){ // didn't respond
                let di = DeviceIDs.indexOf(longsearchdevcnt-1);
                if( di > -1 ){
                  DeviceIDs.splice(di,1); // remove not responded device
                  }
                }
              else */
              if ( newDeviceIDs.length == 1 ) {
                sayLog(LOG, "Add Device ID=" + newDeviceIDs[0]);
                if ( !DeviceIDs.includes(newDeviceIDs[0]) ){
                  DeviceIDs.push(newDeviceIDs[0]);
                  }
                }
              else {
                sayLog(LOG, "Found " + newDeviceIDs.length + " devices when substate is LONGSEARCH");
                }

              if( merc206 ){
                  subState = ClientSubStates.MERC206;
                  //console.log('enter MERC206: ' + message.toString('hex'));
                  stateInterval = setInterval(stateClientMOXA,10);// timeout
                  }
              }
          else if( subState == ClientSubStates.MERC206 ){
              console.log('in MERC206');
              if( merc206 ){
                var message = merc206.request();
                if( message != "END" ){
                  console.log('  send to merc206');
                  client.write(message);
                  stateInterval = setInterval(stateClientMOXA,160);
                  }
                }

              }
          break;
    default :
          break;
    }

}// stateClientMOXA

function connect(){
    client.connect(opts.moxa.port, opts.moxa.host, function() {
        console.log('CONNECTED TO: '+opts.moxa.host+':'+opts.moxa.port);
        stateClientMOXA(ClientEvents.CONNECT_SUCCESS);//IsConnected = true;
      });
}

function ask(dID) {
    var outHex = Buffer.from([dID]).toString('hex')+'0102020202020202'; // open admin channel command
    var crcHex = ('0000'+crc16(hex_to_ascii(outHex)).toString(16)).slice(-4); // crc for this command
    var outgoingMessage = hex_to_ascii(outHex+crcHex.substr(2,2)+crcHex.substr(0,2));
    client.write(outgoingMessage);
    //console.log('WROTE: ' + outHex);
    //setTimeout(ask,opts.moxa.delay1);
}

var commands = ['0816A0', '056000'];//,'150000']; // 0: моментальные значения (ускоренное измерение), 1: накопленная активная энергия по фазам, 2: накопленная реактивная энергия по фазам
//'081411', '056000', '156000': U, Pcumul, Qcumul,
var cmdsnum = commands.length;
var cmdtimeouts = [150,150,150];
var startmoment, endmoment;
async function requestdata(d,cmd) {
    // enumerate commands
    var outHex = Buffer.from([DeviceIDs[d]]).toString('hex')+commands[cmd];
    var crcHex = ('0000'+crc16(hex_to_ascii(outHex)).toString(16)).slice(-4);
    var outgoingMessage = hex_to_ascii(outHex+crcHex.substr(2,2)+crcHex.substr(0,2));
    //console.log('-------------------------------------\nMeter No '+ DeviceIDs[d] + ', cmd '+cmd+', sent: ' + outHex);
    startmoment = moment().valueOf();
    client.write(outgoingMessage);
    RequestedDevices.push(DeviceIDs[d]);
    //reqtimeout = setTimeout(requestdata, cmdtimeouts[cmd], d+1,cmd);
}

// Add a 'data' event handler for the client socket
// data is what the server sent to this socket
client.on('data', function(data) { // not asynchronous!!
    endmoment = moment().valueOf();
    //console.log("TEST"+Buffer.byteLength(data)+" = "+data.length);
    //console.log('RECEIVED COMMAND '+runningcommand+': ' + data.slice(0, data.length-2).toString('hex'), ', searchdevicecounter = '+searchdevicecounter);

    if( data.length < 2 ){
        sayError(RESPLESS2);//console.log('RECEIVED response of length < 2.');
        return;
        }

    if ( clientState == ClientStates.DEVICES_REQUEST && subState == ClientSubStates.MERC206 ){
        var res = merc206.parseanswer(data);
        var msg = {devEui: 'MOXA' + opts.moxa.SN + 'MERC' + res.dID };
        var datatosend = {ts: moment().valueOf(), devEui: msg.devEui, values: res.result};
        iot.sendevent(opts.iotservers, msg.devEui, datatosend);
        return;
        }

    var dID = data.readUInt8(0);

    // check CRC
    if ( data.readUInt16LE(data.length-2) != crc16(data.slice(0, data.length-2)) ) {
//        let er = 'id='+dID+' got '+data.readUInt16LE(data.length-2).toString(16)
//                   +' but calc ' + crc16(data.slice(0, data.length-2)).toString(16);
        let er = 'state=' + clientState + '_' + subState + ', id=' + dID + ' reqdevice='+runningdevice;
        sayError(CRCFAIL, er, {datalen : data.length, data: data.toString('hex')});
        return;
        }

    // for filling deviceID table mode
    newDeviceIDs.push(dID);
    if ( clientState == ClientStates.DEVICES_SEARCH
      || (clientState == ClientStates.DEVICES_REQUEST && subState == ClientSubStates.LONGSEARCH) )
      return;

    // ok we have sensor data receive mode
    if( ! DeviceIDs.includes(dID) ) {
        sayError(ERROR,'dID not in DeviceIDs');
        return;
        }

    // save timers cause of startmoment is changed in requestdata
    var startm = startmoment, time = endmoment - startmoment;
    var device = runningdevice, cmd = runningcommand;

    let ii = RequestedDevices.indexOf(dID);
    if( ii != -1 ) {
        RequestedDevices.splice(ii,1);
        //setTimeout(requestdata,Math.max(0,opts.moxa.timeout-time),runningdevice,runningcommand);
        setTimeout(stateClientMOXA,Math.max(0,opts.moxa.timeout-time));
        }
    else {
        sayError(ERROR,'dID not in RequestedDevices');
        }

    var msg = {devEui: 'SMARTMETER' + opts.moxa.name
                  + ('000000'+dID.toString(10)).slice(-6) };

    //console.log('Parsing command '+ runningcommand +'...');
    var curcommand = -1;
    if( data.length == 15 ) { curcommand = 1; }
    else if ( data.length == 19 ) { curcommand = 2; }
    else if (data.length == 89 ) { curcommand = 0; }
    if( curcommand != cmd ){
        sayError(DIFFCMD,"curcommand == "+curcommand+ " != runningcommand == " + cmd,
                { datalen : data.length, device : msg.devEui });
        }

    var sensordata = null;
    switch (curcommand) {
    case 0: // моментальные значения: ускоренное измерение
            sensordata = {  PT: readPowerValue(data, 1, 'P')/100,   P1: readPowerValue(data, 4, 'P')/100,   P2:readPowerValue(data, 7, 'P')/100,
                            P3: readPowerValue(data, 10, 'P')/100,  QT: readPowerValue(data, 13, 'Q')/100,  Q1:readPowerValue(data, 16, 'Q')/100,
                            Q2: readPowerValue(data, 19, 'Q')/100,  Q3: readPowerValue(data, 22, 'Q')/100,  ST:readPowerValue(data, 25, 'S')/100,
                            S1: readPowerValue(data, 28, 'S')/100,  S2: readPowerValue(data, 31, 'S')/100,  S3:readPowerValue(data, 34, 'S')/100,
                            U1: read3byteUInt(data, 37)/100,        U2: read3byteUInt(data, 40)/100,        U3:read3byteUInt(data, 43)/100,
                            alpha1: read3byteUInt(data, 46)/100,    alpha2: read3byteUInt(data, 49)/100,    alpha3:read3byteUInt(data, 52)/100,
                            I1: read3byteUInt(data, 55)/1000,       I2: read3byteUInt(data, 58)/1000,       I3:read3byteUInt(data, 61)/1000,
                            phiT: readPowerValue(data, 64, 'Q')/1000,       phi1: readPowerValue(data, 67, 'Q')/1000,       phi2: readPowerValue(data, 70, 'Q')/1000, phi3:readPowerValue(data, 73, 'Q')/1000,
                            frequency: read3byteUInt(data, 76)/100,
                            harmonic1: data.readUInt16LE(79)/100,   harmonic2: data.readUInt16LE(81)/100,   harmonic3: data.readUInt16LE(83)/100,
                            T: data.readUInt16LE(85)/100
                            };
            break;
    case 1: // накопленные значения активной энергии по фазам
            sensordata = { Aplus1: read4byteUInt(data, 1), Aplus2: read4byteUInt(data, 5), Aplus3: read4byteUInt(data, 9) };
            break;
    case 2: // накопленные значения реактивной энергии по квадрантам
            sensordata = { R1: read4byteUInt(data, 1), R2: read4byteUInt(data, 5), R3: read4byteUInt(data, 9), R4: read4byteUInt(data, 13) };
            break
    case -1:
            // 'RECEIVED BAD response: '
            sayError(RESPBAD, data.slice(0, data.length-2).toString('hex'),
                      { device : msg.devEui, cmd : cmd});
            return;
    }
    if ( sensordata === null ) {
      sayError(BADSENSDATA);
      return;
    }
    var datatosend = {ts: moment().valueOf(), devEui: msg.devEui, values: sensordata};
    iot.sendevent(opts.iotservers, msg.devEui, datatosend);
});

// Add a 'close' event handler for the client socket
client.on('close', function() {
  console.log('Connection closed');
  clearInterval(stateInterval);
  setTimeout(stateClientMOXA,100,ClientEvents.LOST_CONNECTION);
  });
client.on('end', function(){
  console.log('Other side send FIN packet');
  clearInterval(stateInterval);
  setTimeout(stateClientMOXA,100,ClientEvents.LOST_CONNECTION);
  })
client.on('error', function(err) {
  console.log(err)
  sayError(ERROR,'Socket client',err);
  process.emit('SIGINT');
  });
process.on('SIGTERM',()=>{
  console.log('TERM');
  client.end();
  client.destroy();
  iot.closeconnectors();
  process.exit();
  });
process.on('SIGINT',()=>{
  console.log('INT, then emit TERM');
  clearInterval(stateInterval);
  //setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
  process.emit('SIGTERM');
  });
process.on('uncaughtException', (err,origin)=>{
  const fs = require('fs');
  fs.writeSync(
    process.stderr.fd,
    `Caught exception: ${err}\n` +
    `Exception origin: ${origin}`
  );
  fs.writeSync(process.stdin.fd,'uncaughtException, exit');
  clearInterval(stateInterval);
  client.end();
  client.destroy();
  iot.closeconnectors();
  process.exit();
  });

function hex_to_ascii(str){
  return Buffer.from(str, 'hex');
  }
// read 3-byte Int from the string starting from offset
function read4byteUInt(data, offset) {
  //console.log('read4byteUInt');
  return (data.readUInt16LE(offset) <<16) + data.readUInt16LE(offset+2);
  }
function read3byteUInt(data, offset) {
  //console.log('read3byteUInt');
  return (data.readUInt8(offset) <<16) + data.readUInt16LE(offset+1);
  }
function readPowerValue(data, offset, powertype) {
  //console.log('readPowerValue');
  var p = ((data.readUInt8(offset)&0x3F) <<16) + data.readUInt16LE(offset+1);
  //      if ((data.readUInt8(offset)&0x80)!=0 && powertype=='P') { p *= -1; }
  if ((data.readUInt8(offset)&0x40)==0 && powertype=='Q') { p *= -1; }
  return p;
  }

const ERROR = 0, RESPLESS2 = 1, CRCFAIL = 2, DIFFCMD = 3, RESPBAD = 4, BADSENSDATA = 5;
var myerrors = {};
myerrors[ERROR] = 'descr';
myerrors[RESPLESS2] = 'RECEIVED response of length < 2';
myerrors[CRCFAIL] = 'CRC FAIL';
myerrors[DIFFCMD] = 'Different commands';
myerrors[RESPBAD] = 'RECEIVED BAD response';
myerrors[BADSENSDATA] = 'Bad encoded sensor data';
function sayError(i, str, obj) {
  if( i < 0 || i >= myerrors.length ) return;
  if( typeof str === "undefined" ) str = '';
  console.log('ERROR '+ i + ': ' + myerrors[i] + ' . ' + str);
  if( typeof obj !== "undefined" ) console.log(obj);
  }

const LOG = 0;
var mylogs = {};
mylogs[LOG] = 'descr';
function sayLog(i,str,obj) {
  if( i < 0 || i >= mylogs.length ) return;
  if( typeof str === "undefined" ) str = '';
  console.log('LOG '+ i + ': ' + mylogs[i] + ' . ' + str);
  if( typeof obj !== "undefined" ) console.log(obj);
  }
