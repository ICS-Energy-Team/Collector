'use strict';

/*
  MPV-702.1643 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "MeteoMonitor v. 0.30";
console.log("Hello! Starting " + CollectorName + " at " + Date());
if( process.argv.length < 3 ) {
    console.log('Please specify JSON config name as first argument of script');
    process.exit(1);
    }

// read options
const readConfig = require('./config.js').readConfig;
var opts = readConfig(process.argv[2]);

// device
var TheDevice = opts[opts.device.name], TheDeviceClass; //opts.meteo.find( (el) => { return el.model == "MPV-702"; });
if( TheDevice.model === "MPV-702" ){
    TheDeviceClass = new MeteoMPV(TheDevice);
    }
else if( TheDevice.model === "SOKOL-M1" ){
    TheDeviceClass = new MeteoSokol(TheDevice);
    }

var dataJob, datacheckJob;
const schedule = require('node-schedule');

const net = require('net');
var client = new net.Socket();

function connect(){
    console.log( "try to connect to " + TheDevice.port +':'+ TheDevice.host );
    client.connect(TheDevice.port, TheDevice.host,
        function(){
            console.log('CONNECTED TO: '+TheDevice.host+':'+TheDevice.port);
            if( ! TheDeviceClass.active ){
                dataJob = schedule.scheduleJob(`*/${TheDevice.datainterval} * * * * *`, send);
                }
            datacheckJob = schedule.scheduleJob(`*/${TheDevice.datacheckinterval} * * * * *`, datacheck);
            });
    }

// It starts.
connect();


// get and send date
const Publisher = require('./ICSpublish.js');
var iot = new Publisher(opts);

var endmoment = +new Date();
var datatosend;
// Add a 'data' event handler for the client socket
// data is what the server sent to this socket
client.on('data', function(buf) {

    // parse data
    //console.log(endmoment);
    var data = TheDeviceClass.parse(buf);

    if ( data === null ) {
        sayError({error:'Bad sensor data',message:'buffer: '+buf.toString('hex'),data:{len:buf.length}});
        return;
        }
    if ( data.error ) {
        sayError(data);
        return;
        }

    endmoment = +new Date();
    datatosend = {ts:endmoment, devEui: TheDevice.tbDevEui, values: data};
    // send to iot
    iot.sendevent(opts.iotservers, datatosend.devEui, datatosend);
});


var message = requestcmd(SokolConfig.netaddress);
function send(){
    client.write(message);
    }


// check data income
function datacheck(){
    if ( (+new Date()) - endmoment > TheDevice.datacheckinterval ){
        sayError({error:ERROR, message:"client doesn't send packets more than " + TheDevice.datacheckinterval + 's'});
        process.emit('SIGTERM');
        }
    }



// Add a 'close' event handler for the client socket
client.on('close', function(hadError) {
    if( hadError ){ console.log('socket had transmission error'); }
    console.log('Connection closed. Exit');
    process.emit('SIGTERM');
    });
client.on('error', function(err) {
    console.log(err)
    sayError({error:'ERROR',message:'Socket client',data:err});
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

function sayError(errdata) {
    if( errdata === undefined ) return;
    console.log('ERROR: ' + errdata.error + ' ; Message: ' + errdata.message);
    if( errdata.data ) console.log('Data: ' + JSON.stringify(errdata.data, null, 2) );
    }
    