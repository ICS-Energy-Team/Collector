'use strict';

/*
  Collector.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

const CollectorName = "Collector v. 0.9";
const CollectorVersionDate = "10 Feb 2022";
const _moscowdate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'Europe/Moscow', hour12: false });

console.log("Hello! Starting " + CollectorName + " at " + _moscowdate.format(+new Date()));
if( process.argv.length < 3 ) {
    console.log('Please specify JSON config name as first argument of script');
    process.exit(1);
    }

const net = require('net');
const schedule = require('node-schedule');
const Publisher = require('./ICSpublish.js');


// read options
/*const readConfig = require('./config.js').readConfig;
const readjson = */
//import { readConfig } from 'config';
const readConfig = require('./config.js').readConfig;

const opts = readConfig(process.argv[2]);

const iot = new Publisher(opts);

const mechanisms = [];
var curmechanism = null;
var imech = 0;
const Common = { moxa: opts.moxa, plan: [], optionsfile: process.argv[2] }; // common vars for mechanisms, in plan they write schedules

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
var client = null; //new net.Socket();
var bigbuffer = null;

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
var clientState = ClientStates.SLEEP, stateChanged = false;

const ClientEvents = {
    CONNECT_SUCCESS: 1001,
    LOST_CONNECTION: 1002,
    READY: 1003,
    DEVICES_START_REQUEST: 1004
};
var stateJob, dataJob, timer;

var busy = false;
var waiterslength = 0;
const WAIT_MS = 10;
var wtimer = null;
const maxwaiters = opts.script.maxwaiters;
async function waiters_queue(){
    if ( waiterslength > maxwaiters ){
        sayLog({message:`queue of waiting scripts has reached its maximum length ${maxwaiters}, drop call.`, where:'ICSCollectorjs/waiters_queue'})
        return;
    }
    waiterslength++;
    console.log('waiters_queue length='+waiterslength);
    if ( wtimer ) return;
    wtimer = setTimeout(waiters_try, WAIT_MS);
    }
async function waiters_try(){
    if ( busy ) {
        wtimer = setTimeout(waiters_try, WAIT_MS);
        return;
        }
    if ( clientState != ClientStates.DATA_COLLECTION ) {
        wtimer = setTimeout(waiters_try, 100*WAIT_MS);
        return;
        }
    stateClient(ClientEvents.DEVICES_START_REQUEST);
    waiterslength--;
    if( waiterslength>0 ){
        wtimer = setTimeout(waiters_try, 10*WAIT_MS); // here should be min time of polling all devices (idea) instead of 10*WAIT_MS
        } 
    else {
        wtimer = null;
        }
    }

setState(ClientStates.NOT_CONNECTED);
// Let's go!
stateJob = schedule.scheduleJob('*/2 * * * * *', stateClient);

async function stateClient(newevent) {

    switch (clientState) {
    case ClientStates.NOT_CONNECTED :
        if( newevent == ClientEvents.CONNECT_SUCCESS ) {
            stateJob.cancel();
            setState(ClientStates.DATA_COLLECTION);
            setImmediate(stateClient);//stateInterval = setInterval(stateClientMOXA,10);
            return
            }
        if( stateChanged ){
            stateChanged = false;
            stateJob.cancel();
            stateJob = schedule.scheduleJob(`*/${Common.moxa.connecttimeout} * * * * *`, stateClient); /*each connecttimeout sec try to connect*/
            }
        [client,bigbuffer] = connect(client);
        break;
    case ClientStates.DATA_COLLECTION :
        stateJob.cancel();
        if( newevent == ClientEvents.LOST_CONNECTION )
            {
            sayLog({msg: 'LOST CONNECTION', where:'stateClient, state=DATA_COLLECTION'});
            dataJob.cancel();
            setState(ClientStates.NOT_CONNECTED);
            setImmediate(stateClient);
            clearTimeout(timer);
            busy = false;
            return;
            }
        else if( (newevent == ClientEvents.DEVICES_START_REQUEST) || stateChanged ) 
            {
            if( busy ){
                waiters_queue();
                return;
                }
            busy = true;
            imech = 0;
            curmechanism = mechanisms[imech];
            // запрос данных каждые opts.moxa.datainterval мс
            if( stateChanged ) {
                stateChanged = false;
                setTimeout(()=>{
                    dataJob = schedule.scheduleJob( `*/${Common.moxa.datainterval} * * * * *`, 
                        stateClient.bind(null, ClientEvents.DEVICES_START_REQUEST) )},
                    25000); // wait for search
                }
            }
        if ( curmechanism === null )
            {sayLog({LOG:'curmechanism is null', where:'stateClient()', }); return;}

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
            // no break go to "END" case - choose mechanism
          case "END":
            imech += 1;
            if( imech >= mechanisms.length ){
                curmechanism = null;
                busy = false;
                return;
                }
            curmechanism = mechanisms[imech];
            return stateClient(); // go to request of the next mechanism
            break;
          default:
            // send request to socket
            clearTimeout(timer);
            timer = setTimeout(stateClient,request.timeout);
            startmoment = +new Date();
            client.write(request.request);
            break;
          }
        break;
    }// switch

}// stateClientMOXA

function connect(oldclient){
    if ( oldclient !== null && oldclient.connecting ) oldclient.destroy();
    
    var client = net.createConnection(opts.moxa.port, opts.moxa.host, function() {
        console.log('CONNECTED TO: '+ opts.moxa.host + ':' + opts.moxa.port);
        stateClient(ClientEvents.CONNECT_SUCCESS);//IsConnected = true;
      });

    client.setNoDelay(true);
    client.setKeepAlive(true,Common.moxa.keepaliveInterval);

    client.on('data' , on_socket_data);
    client.on('close', on_socket_close);
    client.on('end'  , on_socket_end);
    client.on('error', on_socket_error);

    return [client, Buffer.from([])];
    }

// a 'data' event handler for the client socket
// data is what the server sent to this socket
// client.on('data', function(buf) { // not asynchronous!!
const eLENGTH = Symbol.for('LENGTH');
function on_socket_data(buf) {
    if ( curmechanism === null ){
        sayError({error:'null', message:'curmechanism is null', data:{bufhex:buf.toString('hex'),len:buf.length}});
        return;
        }

    endmoment = +new Date();
    const time = endmoment - startmoment;
    
    bigbuffer = Buffer.concat([bigbuffer,buf]);
    const data = curmechanism.parse(bigbuffer);
    
    if ( data === null ) {
        bigbuffer = Buffer.from([]);
        sayError({error:'null',message:'A mechanism parser return null ',data:{bufhex: buf.toString('hex'), len:buf.length}});
        return;
        }
    if ( data.error ) {
        if( data.error === eLENGTH && data.data?.cmp == -1 ){
            return; // wait for more data if we have too little bytes
            }
        bigbuffer = Buffer.from([]);
        sayError(data);
        clearTimeout(timer);
        timer = setTimeout(stateClient,0);
        return;
        }
    if ( Number.isInteger(data.timeout) ){
        clearTimeout(timer);
        timer = setTimeout(stateClient,data.timeout - time); // delay less 1 will be setted 1
        }
    if ( data.devEui ) {
        const datatosend = {
            ts: startmoment + Math.floor(time/2), ts0: startmoment, 
            devEui: data.devEui, values: data.values
            };
        if( data.correcttimestamp ) datatosend.ts += data.correcttimestamp; // -correcttimestamp for measure month ago, for example
        iot.sendevent(opts.iotservers, data.devEui, datatosend);
        }
    bigbuffer = Buffer.from([]);
    };//);


// Add a 'close' event handler for the client socket
//client.on('close', function() {
function on_socket_close(){
    console.log('Connection closed ' + _moscowdate.format(+new Date()) );
    stateJob.cancel();
    clearTimeout(timer);
    timer = setTimeout(stateClient,0,ClientEvents.LOST_CONNECTION);
    };//);
//client.on('end', function(){
function on_socket_end(){
    console.log('Other side send FIN packet' + _moscowdate.format(+new Date()) );
    stateJob.cancel();
    clearTimeout(timer);
    timer = setTimeout(stateClient,0,ClientEvents.LOST_CONNECTION);
    };//);
//client.on('error', function(err) {
function on_socket_error(err){
    console.log(err)
    sayError({error:'Error in socket client',data:err});
    process.emit('SIGINT');
    };//);

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

async function sayError(errdata) {
    console.log('ERROR: ' + errdata.error?.toString() + ' . ' + errdata.message);
    if( errdata.data ) console.log('Data: ' + JSON.stringify(errdata.data, null, 2) );
    }

async function sayLog(obj) {
    console.log('LOG: '+ JSON.stringify(obj, null, 2) );
    }
