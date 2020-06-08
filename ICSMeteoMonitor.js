//'use strict';

/*
  Mercury simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "MeteoMonitor v. 0.30";
const moment = require('moment');
console.log("Hello! Starting " + CollectorName + " at " + moment().format("DD MMM YYYY, HH:mm:ss"));

const net = require('net');
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
MPVmeteo = opts.meteo.find( (el) => { return el.model == "MPV-702"; });

var client = new net.Socket();

function connect(){
    console.log( "try to connect to " + MPVmeteo.port +':'+ MPVmeteo.host );
    client.connect(MPVmeteo.port, MPVmeteo.host,
      ()=>{console.log('CONNECTED TO: '+MPVmeteo.host+':'+MPVmeteo.port);});
    }

// It starts.
connect();

var endmoment;
var datatosend;
// Add a 'data' event handler for the client socket
// data is what the server sent to this socket
client.on('data', function(data) {
    endmoment = moment().valueOf();

/*    if( data.length < 2 ){
        sayError(RESPLESS2);
        return;
        }

    // check CS (Checksum)
    if ( data.readUInt16LE(data.length-2) != crc16(data.slice(0, data.length-2)) ) {
        let er = 'id=' + dID + ' start=' + startmoment + ' end=' + endmoment + ' reqdevice='+runningdevice;
        sayError(CRCFAIL, er, {datalen : data.length});
        return;
        }
*/

    // parse data
    //console.log(endmoment);
    const datastr = data.toString();
    //console.log(datastr);
    var sensordata = {};

    for ( const el of datastr.split("\n") ) {
        let info = el.split(',')
        if ( info[0] == '$WIMWV' ) {
            sensordata['WindDirection'] = parseFloat(info[1]);
            sensordata['WindSpeed'] = parseFloat(info[3]);
        } else if( info[0] == '$WIMMB' ) {
            sensordata['BaroPressure'] = parseFloat(info[3]);
        } else if( info[0] == '$WIMHU' ) {
            sensordata['Humidity'] = parseFloat(info[1]);
            sensordata['DewPoint'] = parseFloat(info[3]);
        } else if( info[0] == '$WIMTA' ) {
            sensordata['Temperature'] = parseFloat(info[1]);
        }
    }

    /*sensordata = {  PT: readPowerValue(data, 1, 'P')/100,   P1: readPowerValue(data, 4, 'P')/100,   P2:readPowerValue(data, 7, 'P')/100,
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
    if ( sensordata === null ) {
      sayError(BADSENSDATA);
      return;
    }*/
    datatosend = {ts:endmoment, devEui: MPVmeteo.tbDevEui, values: sensordata};
    // send to iot
    iot.sendevent(opts.iotservers, datatosend.devEui, datatosend);
});

// check data income
var lastCheckTime = moment().valueOf();
const checkPeriod = 30000; // 30 sec
function checkIncome(){
   if ( moment().valueOf() - endmoment > checkPeriod ){
     sayError(ERROR, "client doesn't send packets more than " + checkPeriod + 'ms');
     process.emit('SIGTERM');
   }
}
setInterval(checkIncome,checkPeriod);



// Add a 'close' event handler for the client socket
client.on('close', function(hadError) {
    if( hadError ){ console.log('socket had transmission error'); }
    console.log('Connection closed. Exit');
    process.emit('SIGTERM');
    });
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
    //  console.log('INT, reload config');
    //  readOptions();
    console.log('INT, exit.');
    process.emit('SIGTERM');
    });
