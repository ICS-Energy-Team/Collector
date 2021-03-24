//'use strict';

/*
  MPV-702.1643 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "MeteoMonitor v. 0.30";
console.log("Hello! Starting " + CollectorName + " at " + Date());
const net = require('net');
const Publisher = require('./ICSpublish.js');

// read config
var opts = require('./'+process.argv[2]);

var iot = new Publisher(opts);


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
    endmoment = +new Date();

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

    datatosend = {ts:endmoment, devEui: MPVmeteo.tbDevEui, values: sensordata};
    // send to iot
    iot.sendevent(opts.iotservers, datatosend.devEui, datatosend);
});

// check data income
var lastCheckTime = +new Date();
const checkPeriod = 30000; // 30 sec
function checkIncome(){
   if ( (+new Date()) - endmoment > checkPeriod ){
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
    console.log('INT, exit.');
    process.emit('SIGTERM');
    });

const ERROR = 0;
var myerrors = {};
myerrors[ERROR] = 'descr';
function sayError(i, str, obj) {
    if( i < 0 || i >= myerrors.length ) return;
    if( typeof str === "undefined" ) str = '';
    console.log('ERROR '+ i + ': ' + myerrors[i] + ' . ' + str);
    if( typeof obj !== "undefined" ) console.log(obj);
    }
