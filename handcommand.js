'use strict';
require('json5/lib/register');
const prompt = require('prompt-sync')();
const net = require('net');

let moxaconfig = require('./'+process.argv[2]).moxa;

if( typeof moxaconfig === "undefined" ) {
    console.log("where is moxa config, bro?");
    return;
}
// node singlecommand.js 10.101.0.50 4002 45 MONTHENERGY 1 - энергия за январь со счётчика №45 по адресу 10.101.0.50:4002

const Merc234 = require('./Mercury234parser');
const merc = new Merc234(null,'SIMPLE');


var client = new net.Socket();

client.on('data', function(buf) { // not asynchronous!!
    console.log('Send command: ' + lastcommand.toString('hex'));
    console.log('Output buffer: ' + buf.toString('hex'));
    console.log('Output buffer length: ' + buf.length);
    ask();
    //process.emit('SIGINT');
    });

function connect(args){
    if ( client.connecting ) client.destroy();
    client.connect(args.port, args.host, function() {
        console.log('CONNECTED TO: '+ args.host + ':' + args.port);
        ask();
        });
    }

process.on('SIGINT',()=>{
    client.end();
    client.destroy();
    process.exit();
    });

const hexpattern = /^[0-9A-Fa-f]+$/;
let lastcommand = '';
async function ask(){
    let addr = parseInt(prompt('Write address of meter:'));
    let command = prompt('write command in hex:');
    if( isNaN(addr) || !command.match(hexpattern) ){
        console.log('Try again');
        ask();
    }
    lastcommand = merc.requestcmd(addr,command);
    client.write(lastcommand);
    }

connect(moxaconfig);
