'use strict';

/*
  Collector.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "Collector v. 0.9";
const CollectorVersionDate = "15 Jan 2021";
console.log("Hello! Starting " + CollectorName + " at " + Date());
if( process.argv.length < 3 ) {
    console.log('Please specify JSON config name as first argument of script');
    process.exit(1);
    }

const net = require('net');
const schedule = require('node-schedule');
const Publisher = require('./ICSpublish.js');


// read options
const readConfig = require('./config.js').readConfig;
var opts = readConfig(process.argv[2]);

var iot = new Publisher(opts);

var mechanisms = [];
var curmechanism = null;
var imech = 0;
var Common = {moxa: opts.moxa, plan:[]}; // common vars for mechanisms

if( opts.moxa.Mercury234 && opts.moxa.Mercury234.active ){
    const Merc234 = require('./Mercury234parser');
    mechanisms.push( new Merc234(Common,'SEARCH') );
    mechanisms.push( new Merc234(Common,'COLLECT') );
    mechanisms.push( new Merc234(Common,'LONGSEARCH') );
    if ( opts.moxa.Mercury234.activepowerschedule ) mechanisms.push( new Merc234(Common,'ACTIVEPOWER') );
    if ( opts.moxa.Mercury234.dayenergyschedule ) mechanisms.push( new Merc234(Common,'DAYENERGY') );
    if ( opts.moxa.Mercury234.monthenergyschedule ) mechanisms.push( new Merc234(Common,'MONTHENERGY') );
    }

if ( opts.moxa.Mercury206 ) {
    const Merc206 = require('./Mercury206parser');
    mechanisms.push( new Merc206(opts.moxa) );
    }


Common.plan.forEach(function(p){
    schedule.scheduleJob(p.schedule, p.func);
    });

// RS485-Ethernet converter (MOXA, Teleofis, ...)
var client = new net.Socket();

var startmoment, endmoment = +new Date();

const ClientStates = {
    SLEEP: -1,
    NOT_CONNECTED: 0,
    DATA_COLLECTION: 2
};
function setState(newstate) {
    stateChanged = clientState != newstate;
    clientState = newstate;
    }
var clientState = ClientStates.SLEEP, stateChanged = false, isMechanismWork = false;

const ClientEvents = {
    CONNECT_SUCCESS: 1001,
    LOST_CONNECTION: 1002,
    READY: 1003,
    DEVICES_START_REQUEST: 1004
};
var stateJob, dataJob, timer, datacheckJob;

setState(ClientStates.NOT_CONNECTED);
// Let's go!
stateJob = schedule.scheduleJob('*/2 * * * * *', stateClientMOXA);
setTimeout(function(){
    datacheckJob = schedule.scheduleJob(`*/${Common.moxa.datacheckinterval} * * * * *`, datacheck);
    }, 200000); // wait 200 seconds for search mercury's

async function stateClientMOXA(newevent) {
    switch (clientState) {
    case ClientStates.NOT_CONNECTED :
        if( newevent == ClientEvents.CONNECT_SUCCESS ) {
            stateJob.cancel();
            setState(ClientStates.DATA_COLLECTION);
            return stateClientMOXA();//stateInterval = setInterval(stateClientMOXA,10);
        }
        if( stateChanged ){
            stateChanged = false;
            stateJob.cancel();
            stateJob = schedule.scheduleJob(`*/${Common.moxa.connecttimeout} * * * * *`, stateClientMOXA); /*each connecttimeout msec try to connect*/
            }
        connect();
        break;
    case ClientStates.DATA_COLLECTION :
        stateJob.cancel();
        if( newevent == ClientEvents.LOST_CONNECTION )
            {
            dataJob.cancel();
            setState(ClientStates.NOT_CONNECTED);
            isMechanismWork = false;
            setImmediate(stateClientMOXA);
            return;
            }
        if( (newevent == ClientEvents.DEVICES_START_REQUEST) || stateChanged ) 
            {
            if( isMechanismWork ) return;
            isMechanismWork = true;
            imech = 0;
            curmechanism = mechanisms[imech];
            // запрос данных каждые opts.moxa.datainterval мс
            if( stateChanged ) {
                stateChanged = false;
                dataJob = schedule.scheduleJob( `*/${Common.moxa.datainterval} * * * * *`, stateClientMOXA.bind(null, ClientEvents.DEVICES_START_REQUEST) );
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
                isMechanismWork = false;
                curmechanism = null;
                return;
                }
            curmechanism = mechanisms[imech];
            return stateClientMOXA(); // go to request of the next mechanism
            break;
          default:
            timer = setTimeout(stateClientMOXA,request.timeout);
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
    if ( curmechanism === null ){
        console.log( 'curmechanism is null, buf:' + buf.toString('hex') );
        return;
        }

    var data = curmechanism.parse(buf);

    if ( data === null ) {
        sayError({error:'Bad sensor data',message:'buffer: '+buf.toString('hex'),data:{len:buf.length}});
        return;
        }
    if ( data.error ) {
        sayError(data);
        return;
        }
    if ( Number.isInteger(data.timeout) ){
        clearTimeout(timer);
        timer = setTimeout(stateClientMOXA,Math.max(0,data.timeout - time));
        }
    if ( data.devEui ) {
        var datatosend = {ts: endmoment, devEui: data.devEui, values: data.values};
        if( data.correcttimestamp ) datatosend.ts += data.correcttimestamp; 
        iot.sendevent(opts.iotservers, data.devEui, datatosend);
        }
    });

// check data income
function datacheck(){
    if ( (+new Date()) - endmoment > Common.moxa.datacheckinterval * 1000 ){ // '*1000' - seconds to ms
        sayError({error:"ERROR", message:"client doesn't send packets more than " + Common.moxa.datacheckinterval + 's'});
        process.emit('SIGTERM');
        }
    }


// Add a 'close' event handler for the client socket
client.on('close', function() {
    console.log('Connection closed');
    stateJob.cancel();
    clearTimeout(timer);
    timer = setTimeout(stateClientMOXA,100,ClientEvents.LOST_CONNECTION);
    });
client.on('end', function(){
    console.log('Other side send FIN packet');
    stateJob.cancel();
    clearTimeout(timer);
    timer = setTimeout(stateClientMOXA,100,ClientEvents.LOST_CONNECTION);
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
    stateJob.cancel();
    //setTimeout(stateClientMOXA,1000,ClientEvents.LOST_CONNECTION);
    process.emit('SIGTERM');
    });
process.on('uncaughtException', (err,origin)=>{
    try {
        const fs = require('fs');
        fs.writeSync(
        process.stderr.fd,
        `Caught exception: ${err}\n` +
        `Exception origin: ${origin}\n`
        );
        fs.writeSync(process.stdout.fd,'uncaughtException, exit');
        stateJob.cancel();
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
