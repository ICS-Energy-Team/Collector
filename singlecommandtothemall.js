'use strict';
require('json5/lib/register');
const net = require('net');

let args = require('./'+process.argv[2]);

if( isNaN(args.cmdarg1) ) args.cmdarg1 = 0;

// node singlecommand.js 10.101.0.50 4002 45 MONTHENERGY 1 - энергия за январь со счётчика №45 по адресу 10.101.0.50:4002

const Merc234 = require('./Mercury234parser');
let moxaconfig = null;
if( process.argv[3] ){
    moxaconfig = require('./'+process.argv[3]);
    }
const merc = new Merc234(moxaconfig,'SIMPLE');
merc._devices = [];

var client = new net.Socket();

client.on('data', function(buf) { // not asynchronous!!
    if ( curr_state == 1 ){
        let r = merc._parseSearch(buf);
        console.dir( r );
        if( r.error )
            return;
        curr_state = 2;
        setTimeout(()=>func2(curr_id),30);
        }
    else {
        curr_state = 1;
        curr_id += 1;
        merc._runningcmd = args.cmd;
        let r = merc._parseAnswer(buf);
        console.dir( r );
        }
    // console.log('Send command: ' + merc.getCommand(args).toString('hex'));
    // console.log('Output buffer: ' + buf.toString('hex'));
    // console.log('Output buffer length: ' + buf.length);
    // console.log('Output object: ');
    // console.dir( merc.parseRequest(args.cmd,buf) );
        //process.emit('SIGINT');
    });

var curr_id = 0;
var curr_state = 1;
function connect(){
    if ( client.connecting ) client.destroy();
    client.connect(args.port, args.host, function() {
        console.log('CONNECTED TO: '+ args.host + ':' + args.port);
        setInterval( ()=>func1(curr_id), 200 );
        });
    }

function func1(i){
    let loc_args = {...args};
    loc_args.id = args.ids[i];
    loc_args.cmd = 'ADMIN'
    client.write(merc.getCommand(loc_args));
    }

function func2(i){
    let loc_args = {...args};
    loc_args.id = args.ids[i];
    client.write(merc.getCommand(loc_args));
    }


process.on('SIGINT',()=>{
    client.end();
    client.destroy();
    process.exit();
    })


connect();
