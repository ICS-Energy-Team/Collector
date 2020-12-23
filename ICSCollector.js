'use strict';

/*
  Collector.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "Collector v. 0.9";
const CollectorVersionDate = "23 Dec 2020";
console.log("Hello! Starting " + CollectorName + " at " + Date());

const net = require('net');
var iot = require('./ICSpublish.js');

require('json5/lib/register');
var opts;// = require('./'+process.argv[2]);
function readOptions () {
    opts = require('./'+process.argv[2]);
    // need static options check
    }
readOptions();

var mechanisms = [];
var curmechanism = null;
var imech = 0;
var Common = {moxa: opts.moxa}; // common vars for mechanisms

if( opts.moxa.Mercury234 && opts.moxa.Mercury234.active ){
    const Merc234 = require('./Mercury234parser');
    mechanisms.push( new Merc234(Common,'SEARCH') );
    mechanisms.push( new Merc234(Common,'COLLECT') );
    mechanisms.push( new Merc234(Common,'LONGSEARCH') );
    }

if ( opts.moxa.Mercury206 ) {
    const Merc206 = require('./Mercury206parser');
    mechanisms.push( new Merc206(opts.moxa) );
    }

// MOXA

var client = new net.Socket();
var startmoment, endmoment;

const ClientStates = {
    SLEEP: -1,
    NOT_CONNECTED: 0,
    DATA_COLLECTION: 2
};
function setState(newstate) {
    stateChanged = clientState != newstate;
    clientState = newstate;
    }
var clientState = ClientStates.SLEEP, stateChanged = false;

const ClientEvents = {
    CONNECT_SUCCESS: 1001,
    LOST_CONNECTION: 1002,
    READY: 1003,
    DEVICES_START_REQUEST: 1004
};
var stateInterval, dataInterval;

setState(ClientStates.NOT_CONNECTED);
// Let's go!
stateClientMOXA();

async function stateClientMOXA(newevent) {
    switch (clientState) {
    case ClientStates.NOT_CONNECTED :
        if( newevent == ClientEvents.CONNECT_SUCCESS ) {
            clearInterval(stateInterval);
            setState(ClientStates.DATA_COLLECTION);
            return stateClientMOXA();//stateInterval = setInterval(stateClientMOXA,10);
        }
        if( stateChanged ){
            stateChanged = false;
            clearInterval(stateInterval);
            stateInterval = setInterval(stateClientMOXA,5000/*each 5sec try to connect*/);
            }
        connect();
        break;
    case ClientStates.DATA_COLLECTION :
        clearInterval(stateInterval);
        if( newevent == ClientEvents.LOST_CONNECTION ){
            clearInterval(dataInterval);
            setState(ClientStates.NOT_CONNECTED);
            return stateClientMOXA();
            }
        if( newevent == ClientEvents.DEVICES_START_REQUEST || stateChanged ) {
            imech = 0;
            curmechanism = mechanisms[imech];
            // запрос данных каждые opts.moxa.datainterval мс
            if( stateChanged ) {
                stateChanged = false;
                dataInterval = setInterval(stateClientMOXA, opts.moxa.datainterval, ClientEvents.DEVICES_START_REQUEST);
                }
            }
        if ( curmechanism === null ) return;
        var request = curmechanism.request();
        switch(request){
          case "EXIT":
            curmechanism = null;
            console.log( "Collector: Some mechanism send EXIT, I quit." );
            process.emit('SIGTERM');
            break;
          case "DELETE":
            mechanisms.splice(imech,1); imech -= 1;
            curmechanism = null; 
            // go to "END" case - choose mechanism
          case "END":
            imech += 1;
            if( imech >= mechanisms.length ){
                curmechanism = null;
                return;
                }
            curmechanism = mechanisms[imech];
            return stateClientMOXA(); // go to request of the next mechanism
            break;
          default:
            stateInterval = setInterval(stateClientMOXA,request.timeout);
            startmoment = +new Date();
            client.write(request.request);
            break;
          }
        break;
    }

}// stateClientMOXA

function connect(){
    if ( client.connecting ) client.destroy();
    client.connect(opts.moxa.port, opts.moxa.host, function() {
        console.log('CONNECTED TO: '+ opts.moxa.host + ':' + opts.moxa.port);
        stateClientMOXA(ClientEvents.CONNECT_SUCCESS);//IsConnected = true;
      });
}

// Add a 'data' event handler for the client socket
// data is what the server sent to this socket
client.on('data', function(buf) { // not asynchronous!!
    endmoment = +new Date();
    var time = endmoment - startmoment;
    //console.log("TEST"+Buffer.byteLength(data)+" = "+data.length);
    //console.log('RECEIVED COMMAND '+runningcommand+': ' + data.slice(0, data.length-2).toString('hex'), ', searchdevicecounter = '+searchdevicecounter);

    var data = curmechanism.parse(buf);

    if ( data === null ) {
        sayError({error:'Bad sensor data'});
        return;
        }
    if ( data.error ) {
        sayError(data);
        return;
        }
    if ( Number.isInteger(data.timeout) ){
        clearInterval(stateInterval);
        setTimeout(stateClientMOXA,Math.max(0,data.timeout - time));
        }
    if ( data.devEui ) {
        var datatosend = {ts: endmoment, devEui: data.devEui, values: data.values};
        iot.sendevent(opts.iotservers, data.devEui, datatosend);
        }
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
    sayError({error:'Error in socket client',data:err});
    process.emit('SIGINT');
    });
process.on('SIGTERM',()=>{
    try {
        console.log('TERM');
        client.destroy();
        iot.closeconnectors();
        }
    finally {
        process.exit();
        }
    });
process.on('SIGINT',()=>{
    console.log('INT, then emit TERM');
    clearInterval(stateInterval);
    //setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
    process.emit('SIGTERM');
    });
process.on('uncaughtException', (err,origin)=>{
    try {
        const fs = require('fs');
        fs.writeSync(
        process.stderr.fd,
        `Caught exception: ${err}\n` +
        `Exception origin: ${origin}`
        );
        fs.writeSync(process.stdout.fd,'uncaughtException, exit');
        clearInterval(stateInterval);
        client.destroy();
        iot.closeconnectors();
        }
    finally{
        process.exit();
        }
    });

function sayError(errdata) {
    if( errdata === undefined ) return;
    console.log('ERROR: ' + errdata.error + ' . ' + errdata.message);
    if( errdata.data ) console.log('Data: ' + JSON.stringify(errdata.data, null, 2) );
    //if( typeof obj !== "undefined" ) console.log(obj);
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
