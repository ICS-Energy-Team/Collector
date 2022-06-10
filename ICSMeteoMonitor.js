'use strict';

/*
  MPV-702.1643 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "MeteoMonitor v. 0.90";
const CollectorVersionDate = "05 Feb 2022";
console.log("Hello! Starting " + CollectorName + " at " + Date());
if( process.argv.length < 3 ) {
    console.log('Please specify JSON config name as first argument of script');
    process.exit(1);
    }

// read options
const readConfig = require('./config.js').readConfig;
const opts = readConfig(process.argv[2]);

// device
const TheDevice = opts[opts.device.name];
var TheDeviceClass, devicemessage; //opts.meteo.find( (el) => { return el.model == "MPV-702"; });
if( TheDevice.model === "MPV-702" ){
    let MC = require('./MeteoMPVparser.js').MeteoMPV;
    TheDeviceClass = new MC(TheDevice);
    }
else if( TheDevice.model === "SOKOL-M1" ){
    let MC = require('./MeteoSokolparser.js').MeteoSokol;
    TheDeviceClass = new MC(TheDevice);
    }
else{ 
    console.log('unknown device model');
    process.exit(1);
 }

var dataJob;
const schedule = require('node-schedule');

const net = require('net');
var client = null; //new net.Socket();

// It starts.
client = connect(client);

// get and send date
const Publisher = require('./ICSpublish.js');
const iot = new Publisher(opts);

// Add a 'data' event handler for the client socket
// data is what the server sent to this socket
var endmoment;
function on_socket_data(buf) {

    endmoment = + new Date();
    // parse data
    //console.log(endmoment);
    var data = TheDeviceClass.parse(buf);

    if ( data === null ) {
        data = {error:'Bad sensor data',message:'parser return null',data:{len:buf.length,buffer:buf.toString('hex')}};
        }
    if ( data.error ) {
        sayError(data);
        return;
        }

    // send to iot
    iot.sendevent(opts.iotservers, TheDevice.tbDevEui, 
        {ts:endmoment, devEui: TheDevice.tbDevEui, values: data});
    }

function connect(oldclient){
    if ( oldclient !== null && oldclient.connecting ) oldclient.destroy();
    console.log( "try to connect to " + TheDevice.port +':'+ TheDevice.host );    

    const client = net.createConnection(TheDevice.port, TheDevice.host, 
        function(){
            console.log('CONNECTED TO: '+TheDevice.host+':'+TheDevice.port);
            if( ! TheDeviceClass.active ){
                devicemessage = TheDeviceClass.request();
                dataJob = schedule.scheduleJob(`*/${TheDevice.datainterval} * * * * *`, send);
                }
            });

    client.setNoDelay(true);
    client.setKeepAlive(true,TheDevice.keepaliveInterval);

    client.on('data' , on_socket_data);
    client.on('close', on_socket_close);
    client.on('end'  , on_socket_end);
    client.on('error', on_socket_error);

    return client;
    }

    function send(){
        client.write(devicemessage);
        }


// Add a 'close' event handler for the client socket
function on_socket_close(hadError) {
    if( hadError ){ console.log('socket had transmission error'); }
    console.log('Connection closed. Exit');
    process.emit('SIGTERM');
    };
function on_socket_end(){
    console.log('Other side send FIN packet');
    process.emit('SIGTERM');
    };
function on_socket_error(err) {
    console.log(err)
    sayError({error:'ERROR',message:'Socket client',data:err});
    };

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
    