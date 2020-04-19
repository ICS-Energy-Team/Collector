//'use strict';

/*
  Mercury simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const net = require('net');
const crc16 = require('crc').crc16modbus;

const moment = require('moment');
var iot = require('./ICSpublish.js');

var opts;// = require('./'+process.argv[2]);
function readOptions () {
  opts = require('./'+process.argv[2]);
}
readOptions();

const ERROR = 0, RESPLESS2 = 1, CRCFAIL = 2, DIFFCMD = 3, RESPBAD = 4, BADSENSDATA = 5
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

// MOXA

var runningcommand = 0;
var runningdevice = 0;
var DeviceIDs = [];
var RequestedDevices = [];

var client = new net.Socket();
const ClientStates = {
    SLEEP: -1,
    NOT_CONNECTED: 0,
    CONNECTED: 1,
    DEVICES_SEARCH: 2,
    DEVICES_REQUEST: 3
};
const ClientEvents = {
    TRY_TO_RUN: 1000,
    CONNECT_SUCCESS: 1001,
    LOST_CONNECTION: 1002,
    DEVICES_FOUND: 1003,
    DEVICES_START_REQUEST: 1004,
    DEVICES_START_SEARCH: 1005
};
const MIN_DEVICE_ID = 1, MAX_DEVICE_ID = 255;
var searchdevicecounter;
var stateInterval;
var clientState = ClientStates.SLEEP, stateChanged = false;
function setState(newstate) {
    stateChanged = clientState != newstate;
    clientState = newstate;
}
stateClientMOXA(ClientEvents.TRY_TO_RUN);
async function stateClientMOXA(newevent) {
    switch (clientState) {
    case ClientStates.SLEEP :
          if( newevent == ClientEvents.TRY_TO_RUN ) {
              setState(ClientStates.NOT_CONNECTED);
              return stateClientMOXA();
          }
          break;
    case ClientStates.NOT_CONNECTED :
          if( newevent == ClientEvents.CONNECT_SUCCESS ) {
              clearInterval(stateInterval);
              setState(ClientStates.DEVICES_SEARCH);
              return stateClientMOXA();//stateInterval = setInterval(stateClientMOXA,10);
          }
          if( stateChanged ){
              stateChanged = false;
              clearInterval(stateInterval);
              stateInterval = setInterval(stateClientMOXA,5000/*5sec*/);
              }
          connect();
          break;
    case ClientStates.DEVICES_SEARCH :
          if( newevent == ClientEvents.LOST_CONNECTION ){
              clearInterval(stateInterval);
              setState(ClientStates.NOT_CONNECTED);
              return stateClientMOXA();
              }
          else if( newevent == ClientEvents.DEVICES_FOUND || searchdevicecounter > MAX_DEVICE_ID ){
              clearInterval(stateInterval);
              DeviceIDs = [...new Set(DeviceIDs)]; // get only unique IDs
              console.log("Found "+DeviceIDs.length+" devices: "+DeviceIDs);
              setState(ClientStates.DEVICES_REQUEST);
              return stateClientMOXA();
              }
          // fill the device list by trying to admin connect to each device with interval opts.moxa.delay1
          // loop all possible device ids
          if( stateChanged ){
              stateChanged = false;
              DeviceIDs = [];
              searchdevicecounter = MIN_DEVICE_ID;
              clearInterval(stateInterval);
              stateInterval = setInterval(stateClientMOXA,opts.moxa.delay1);
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
          else if ( newevent == ClientEvents.DEVICES_START_SEARCH ) {
              clearInterval(dataInterval);
              setState(ClientStates.DEVICES_SEARCH);
              return stateClientMOXA();
              }
          if( newevent == ClientEvents.DEVICES_START_REQUEST || stateChanged ){
              if( stateChanged ) {
                  stateChanged = false;
                  dataInterval = setInterval(stateClientMOXA, opts.moxa.delay2, ClientEvents.DEVICES_START_REQUEST);
                  }
              if( RequestedDevices.length ) {
                  sayLog(LOG,'not responsed RequestedDevices: ' + RequestedDevices);
              }
              RequestedDevices = [];
              runningdevice = 0;
              runningcommand = 0;
              console.log('REQUEST ALL DEVICES...');
              }
          if ( runningdevice >= DeviceIDs.length ) {return;}

          requestdata(runningdevice,runningcommand);
          // запрос данных каждые opts.moxa.delay2 мс
          stateInterval = setInterval(stateClientMOXA, cmdtimeouts[runningcommand]);
          runningdevice++;
          dataCounter++;
          break;
    default :
          break;
    }

}// stateClientMOXA

var devicesInterval = setInterval(stateClientMOXA, opts.moxa.refreshDevicesDelay, ClientEvents.DEVICES_START_SEARCH);
var dataInterval;

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
var reqtimeout;
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
var rcvtime = [[],[]];
function getMaxOfArray(arr){
    return arr.reduce( (a,b) => { return Math.max(a,b); } )
}
var dataCounter = 0;
client.on('data', function(data) { // not asyncchronous!!
    endmoment = moment().valueOf();
    //console.log("TEST"+Buffer.byteLength(data)+" = "+data.length);
    //console.log('RECEIVED COMMAND '+runningcommand+': ' + data.slice(0, data.length-2).toString('hex'), ', searchdevicecounter = '+searchdevicecounter);

    if( data.length < 2 ){
        sayError(RESPLESS2);//console.log('RECEIVED response of length < 2.');
        return;
        }

    var dID = data.readUInt8(0);

    // check CRC
    if ( data.readUInt16LE(data.length-2) != crc16(data.slice(0, data.length-2)) ) {
//        let er = 'id='+dID+' got '+data.readUInt16LE(data.length-2).toString(16)
//                   +' but calc ' + crc16(data.slice(0, data.length-2)).toString(16);
        let er = 'id=' + dID + ' start=' + startmoment + ' end=' + endmoment + ' reqdevice='+runningdevice;
        sayError(CRCFAIL, er, {datalen : data.length});
        return;
        }

    // filling deviceID table mode
    if (clientState == ClientStates.DEVICES_SEARCH ) {
        DeviceIDs.push(dID);
        return;
        }

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
  clearInterval(devicesInterval);
  clearInterval(stateInterval);
  setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
  });
client.on('end', function(){
  console.log('Other side send FIN packet');
  clearInterval(devicesInterval);
  clearInterval(stateInterval);
  setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
  })
client.on('error', function(err) {
  console.log(err)
  sayError(ERROR,'Socket client',err);
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
  clearInterval(devicesInterval);
  clearInterval(stateInterval);
  //setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
  process.emit('SIGTERM');
  });
process.on('uncaughtException', (err,origin)=>{
  fs.writeSync(
    process.stderr.fd,
    `Caught exception: ${err}\n` +
    `Exception origin: ${origin}`
  );
  process.emit('SIGINT');
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
