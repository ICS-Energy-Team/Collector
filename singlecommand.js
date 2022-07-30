'use strict';
require('json5/lib/register');
const net = require('net');

let args = require('./'+process.argv[2]);

if( isNaN(args.cmdarg1) ) args.cmdarg1 = 0;

// node singlecommand.js 10.101.0.50 4002 45 MONTHENERGY 1 - энергия за январь со счётчика №45 по адресу 10.101.0.50:4002

const Merc234 = require('./Mercury234parser');
const merc = new Merc234(null,'SIMPLE');


var client = new net.Socket();

client.on('data', function(buf) { // not asynchronous!!
    console.log('Send command: ' + merc.getCommand(args).toString('hex'));
    console.log('Output buffer: ' + buf.toString('hex'));
    console.log('Output buffer length: ' + buf.length);
    console.log('Output object: ');
    console.dir( merc.parseRequest(args.cmd,buf) );
    //process.emit('SIGINT');
    });

function connect(){
    if ( client.connecting ) client.destroy();
    client.connect(args.port, args.host, function() {
        console.log('CONNECTED TO: '+ args.host + ':' + args.port);
        if( args.ids ){
            for( let i = 0 ; i < args.ids.length; i+=1 ){
                args.id = args.ids[i];
                setTimeout(()=>{client.write(merc.getCommand(args));}, 300*i);
                }
            } 
        else {
            client.write(merc.getCommand(args));
            }
        });
    }

process.on('SIGINT',()=>{
    client.end();
    client.destroy();
    process.exit();
    })


connect();
