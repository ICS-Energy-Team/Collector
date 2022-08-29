// @ts-check
'use strict';

const crc16 = require('crc').crc16modbus;

const readjson = require('./config.js').readjson;
//import { readjson } from 'config';
const fs = require('fs/promises');
//import { writeFile } from 'fs/promises';


/*
  Mercury234 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

class Mercury234{
    constructor(common, mode = 'SEARCH'){
        this._version = "MercuryMonitor v. 1.7 for Mercury 234";
        this._versiondate = "15 Jan 2020";
        // FAST - моментальные значения: ускоренное измерение
        // ACTIVEPOWER - накопленные значения активной энергии по фазам
        // REACTPOWER - накопленные значения реактивной энергии по квадрантам
        // DAYENERGY - total day active and reactive energy up to the current time
        this._commands = {'FAST': '0816A0', 'ACTIVEPOWER': '056000', 'REACTPOWER':'150000', 'ADMIN':'0102020202020202',
                        'SERIALNUMBER': '0800', 'DAYENERGY':'054000', 'MONTHENERGY': '053100', 'TIME': '0400', 
                        'GET_TRANSFORM_COEFF':'0802','SET_TRANSFORM_COEFF':'031B'
                        };        //'081411', '056000', '156000': U, Pcumul, Qcumul,
        if(common){
            this.Common = common;
            this._searchdelay = common.moxa.Mercury234.searchdelay;
            this._cmdmintimeout = common.moxa.Mercury234.mintimeout;
            this._cmdmaxtimeout = common.moxa.Mercury234.maxtimeout;    
        }
        if ( mode == 'SIMPLE' ) {
            //this._twodigits = new Intl.NumberFormat('en-US',{minimumIntegerDigits:2})
            this._searchmethod = 'ADMIN';
            return;
            }
        
        this._datafile = './' + common.optionsfile + '.parserdata';
        this._searchdelay = common.moxa.Mercury234.searchdelay;
        this._cmdmintimeout = common.moxa.Mercury234.mintimeout;
        this._cmdmaxtimeout = common.moxa.Mercury234.maxtimeout;
        this.MIN_DEVICE_ID = 1;
        this.MAX_DEVICE_ID = 250;
        //this._requested_devices = [];

        this._mode = mode;
        this._EnergyModes = new Set(['ACTIVEPOWER', 'DAYENERGY', 'MONTHENERGY']);
        // for human datetime
        this._moscowdate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'Europe/Moscow', hour12: false });

        if ( mode == 'SEARCH' ) {
            this.request = this._search;
            this.parse = this._parseSearch;
            if (typeof common.moxa.Mercury234.devices === 'undefined') {
                common.moxa.Mercury234.devices = [];
                common.moxa.Mercury234.devices_conf = new Map();
                }

            this._i = -1;

            const { found_devices } = readjson(this._datafile);
            if( Array.isArray(found_devices) && (found_devices.length > 0) ){
                this._searchmethod = 'ADMIN';
                this._devices = [];
                let array_tosearch = [], conf = new Map();
                found_devices.forEach( v => {
                    array_tosearch.push( v.id );
                    conf.set( v.id, v );
                    });
                this._array_tosearch = array_tosearch;
                common.moxa.Mercury234.devices_conf = conf;
                }
            else { 
                this._searchmethod = 'GET_TRANSFORM_COEFF';
                this._devices = new Map();
                let min = this.MIN_DEVICE_ID, max = this.MAX_DEVICE_ID;
                this._array_tosearch = Array.from({length: max-min+1}, (_, i) => i + min); 
                }
            }
        else if ( mode == 'COLLECT' ) {
            this._runningcmd = 'FAST';
            this.request = this._request;
            this.parse = this._parseAnswer;
            this._devices = common.moxa.Mercury234.devices;
            this._devices_conf = common.moxa.Mercury234.devices_conf;
            this._i = -1;
            }
        else if ( mode == 'LONGSEARCH' ) {
            this.request = this._longsearch;
            this.parse = this._parseSearch;
            this._devices = [];
            this._i = this.MIN_DEVICE_ID-1;
            this._tick = false;
            }
        else if ( this._EnergyModes.has(mode) ) {
            this._runningcmd = mode;
            this.request = this._longRequest;
            this.parse = this._parseAnswer;
            this._devices = common.moxa.Mercury234.devices;
            this._i = -1;
            this._tick = false;
            this._turnOn = true;
            if( mode == 'ACTIVEPOWER' ) common.plan.push({ func : this._wakeUp.bind(this), schedule : common.moxa.Mercury234.activepowerschedule });
            if( mode == 'DAYENERGY' ) common.plan.push({ func : this._wakeUp.bind(this), schedule : common.moxa.Mercury234.dayenergyschedule });
            if( mode == 'MONTHENERGY' ) {
                this._turnOn = false; // wait for schedule run
                common.plan.push({ func : this._wakeUp.bind(this), schedule : common.moxa.Mercury234.monthenergyschedule });
                }
            }
    
        }// constructor

    _search(){
        if( this._i == -1 ) console.log("START SEARCH");
        this._i += 1;
        if( this._i >= this._array_tosearch.length ){
            if( this._devices.length === 0 ) {
                console.log( "I haven't found any devices. I have to halt collector due to config" );
                return "EXIT";
                }
            if( this._searchmethod == 'GET_TRANSFORM_COEFF' ) {
                this._devices = [];
                this._array_tosearch = [... this._devices.values()].map( x=>x.id );
                this.Common.moxa.Mercury234.devices_conf = this._devices;
                this._searchmethod = 'ADMIN'; // start open channels with found devices
                this.i = 0;    
                }
            else {
                this.Common.moxa.Mercury234.devices = this._devices;
                console.log("Found "+this._devices.length+" devices: "+this._devices);
                fs.writeFile(this._datafile,JSON.stringify({found_devices:[... this.Common.moxa.Mercury234.devices_conf.values()]}),'utf8');
                return "SEARCH_END";    
                }
            }
        return { request: this.requestcmd(this._array_tosearch[this._i],this._commands[this._searchmethod]), timeout: this._searchdelay };
        }

    _request(){
        if( this._i == -1 ) {
            console.log('REQUEST ALL ' + this._devices.length + ' DEVICES: ' + this._devices + '    at ' + this._moscowdate.format(+new Date()));
            }

        this._i += 1;
        if( this._i >= this._devices.length ) {
            this._i = -1;
            return "END";
            }

        const d = this._devices[this._i];
        //this._requested_devices.push(d);
        this._runningdevice = d;
        return {
            request: this.requestcmd(d,this._commands[this._runningcmd]), 
            timeout: this._cmdmaxtimeout
            };
        }

    _longsearch(){
        if( this._tick ) {
            this._endlongsearch();
            return "END";
            }

        this._i += 1;
        if( this._i > this.MAX_DEVICE_ID )
            this._i = this.MIN_DEVICE_ID;


        this._tick = true;
        return {request: this.requestcmd(this._i,this._commands['ADMIN']), timeout: this._searchdelay };
        }
    async _endlongsearch(){
        if ( this._devices.length > 1 ) console.log('LOG: Strange, I found more than 1 device');
        let flag = false;
        for( let i = 0; i<this._devices.length; i++){
            if ( !this.Common.moxa.Mercury234.devices.includes(this._devices[i]) ){
                this.Common.moxa.Mercury234.devices.push(this._devices[i]);
                flag = true;
                }
            }
        if ( flag ){
            fs.writeFile(this._datafile,JSON.stringify({found_devices:this.Common.moxa.Mercury234.devices}),'utf8');
            }
        if ( this._devices.length > 0 )
            console.log("Mercury234parser. Found " +  JSON.stringify(this._devices) + " devices when in _longsearch");
        else
            console.log("Mercury234parser. Not found device with ID=" +  this._i + " when in _longsearch");
        this._devices = [];
        this._tick = false;
        }

    _wakeUp(){
        if ( ! this._EnergyModes.has(this._mode) ) return;
        console.log('mode '+this._mode+ " has woken up on "  + Date());
        this._turnOn = true;
        this._tick = false
        this._i = -1;
        if( this._mode == 'MONTHENERGY' ){
            let d = (new Date()).getMonth(); /* month fron 0(Jan) to 11(Dec) */
            /* Mercury read month energy command from 1(Jan) to 12(Dec)
                so we don't have to decrease d to get previous month
            */
            if ( d == 0 ) d = 12; // only this special case
            this._commands['MONTHENERGY'] = setmonthenergy(d);
            }
        }

    _longRequest(){ // one per datainterval request
        if( ! this._turnOn ) return "END";
        if( this._tick ) { // for only single run of this mechanism in one moxa.datainterval
            this._tick = false;
            return "END";
            }

        this._i += 1;

        if( this._i >= this._devices.length ) {
            this._turnOn = false;
            this._tick = false;
            this._i = -1;
            return "END";
            }

        this._tick = true;
        let d = this._devices[this._i];
        //this._requested_devices.push(d);
        return { request: this.requestcmd(d,this._commands[this._runningcmd]), timeout: this._cmdmaxtimeout };
        }

    _parseSearch(buf){
        let cmp = this.check_buf_length(this._searchmethod,buf);
        if ( cmp != 0 )
            { return sayError(eLENGTH,undefined,{cmp: cmp, buflen:buf.length, buf: buf.toString('hex'), where: 'Mercury234parser._parseSearch'}); }
    
        var dID = buf.readUInt8(0);

        // check CRC
        if ( buf.readUInt16LE(buf.length-2) != crc16(buf.slice(0, buf.length-2)) ) {
            return sayError(eCRC,  'MODBUS error, id from packet=' + dID, {buf: buf.toString('hex'), where: 'Mercury234._parseSearch'});
            }
        
        if( this._searchmethod == 'GET_TRANSFORM_COEFF' ){
            let res = this.parseRequest(this._searchmethod,buf);
            res.id = dID;
            this._devices.set(dID, res);
            }
        else{
            this._devices.push(dID);
            }
        return {timeout:0};
        }

    // depends on this._runningcmd !
    _parseAnswer(buf){
        let cmp = this.check_buf_length(this._runningcmd,buf);
        if ( cmp != 0 )
            { return sayError(eLENGTH,undefined,{cmp: cmp, buflen:buf.length, buf: buf.toString('hex'), where: 'Mercury234parser._parseAnswer'}); }
    
        var dID = buf.readUInt8(0);

        // check CRC
        if ( buf.readUInt16LE(buf.length-2) != crc16(buf.slice(0, buf.length-2)) ) {
            let er = 'MODBUS error, id from packet=' + dID + ' requested id=' + this._devices[this._i];
            return sayError(eCRC, er, {datalen : buf.length, buf: buf.toString('hex'), where: 'Mercury234._parseAnswer'});
            }
    
        // ok we have sensor data receive mode
        var timeout = this._cmdmintimeout;
        /*var timeout = this._cmdmaxtimeout;
        let ii = this._requested_devices.indexOf(dID);
        if( ii != -1 ) {
            this._requested_devices.splice(ii,1);
            timeout = this._cmdmintimeout;
            }
        else {
            return sayError(eERROR,'dID not in RequestedDevices', {dID: dID});
            }*/
    
        var devEui = this.Common.moxa.name.slice(-10) +
                    '-MR234-' + ('000'+dID.toString(10)).slice(-3);
    
        //console.log('Parsing command '+ runningcommand +'...');
        var sensordata = this.parseRequest(this._runningcmd,buf);
        if( this._runningcmd == 'FAST' ) {
            this.transformation_coeff_multiply( dID, sensordata );
            }
        if ( sensordata === null ){
            return sayError(eRESPONSE, 'buffer: '+buf.toString('hex'), {buflen:buf.length, devEui: devEui});
            }
        var data = {devEui: devEui, values: sensordata, timeout: timeout};

        if( this._runningcmd === 'MONTHENERGY' ){
            data.correcttimestamp = - 2_419_200_000; // ms in 28 days ~ one month ago
            }

        return data;
        }// parseAnswer

    getCommand(args){
        let fullcmd = this._commands[args.cmd];
        if ( args.cmd == 'MONTHENERGY' )
            fullcmd = setmonthenergy(args.month);
        if ( args.cmd == 'SET_TRANSFORM_COEFF' ) {
            let t = Buffer.from([0,1,0,1]);
            t.writeUInt16BE(args.coeff_voltage || 1,0);
            t.writeUInt16BE(args.coeff_current || 1,2);
            fullcmd += t.toString('hex');
            }
        return this.requestcmd(args.id, fullcmd);
        }

    parseRequest(cmd,buf){
        var res = null;
        switch( cmd ){
            case 'FAST': // моментальные значения: ускоренное измерение
                let [pt,st] = read_activepower_and_sign(buf, 1);
                let [p1,s1] = read_activepower_and_sign(buf, 4);
                let [p2,s2] = read_activepower_and_sign(buf, 7);
                let [p3,s3] = read_activepower_and_sign(buf, 10);
                res = {  PT: pt,    P1: p1,   P2: p2,   P3: p3, PTsign: pt*st,  P1sign: p1*s1,  P2sign: p2*s2,  P3sign: p3*s3,
                    QT: readPowerValue(buf, 13, 'Q')/100,   Q1:readPowerValue(buf, 16, 'Q')/100,    Q2: readPowerValue(buf, 19, 'Q')/100,  Q3: readPowerValue(buf, 22, 'Q')/100,
                    ST:readPowerValue(buf, 25, 'S')/100,    S1: readPowerValue(buf, 28, 'S')/100,   S2: readPowerValue(buf, 31, 'S')/100,  S3:readPowerValue(buf, 34, 'S')/100,
                    U1: read3byteUInt(buf, 37)/100,         U2: read3byteUInt(buf, 40)/100,         U3:read3byteUInt(buf, 43)/100,
                    alpha1: read3byteUInt(buf, 46)/100,    alpha2: read3byteUInt(buf, 49)/100,    alpha3:read3byteUInt(buf, 52)/100,
                    I1: read3byteUInt(buf, 55)/1000,       I2: read3byteUInt(buf, 58)/1000,       I3:read3byteUInt(buf, 61)/1000,
                    phiT: readPowerValue(buf, 64, 'Q')/1000,       phi1: readPowerValue(buf, 67, 'Q')/1000,       phi2: readPowerValue(buf, 70, 'Q')/1000, phi3:readPowerValue(buf, 73, 'Q')/1000,
                    frequency: read3byteUInt(buf, 76)/100,
                    harmonic1: buf.readUInt16LE(79)/100,   harmonic2: buf.readUInt16LE(81)/100,   harmonic3: buf.readUInt16LE(83)/100,
                    T: buf.readUInt16LE(85)/100
                    };
                if ( buf.length == 98 ){
                    res['U12'] = read3byteUInt(buf, 87) / 100 ;
                    res['U23'] = read3byteUInt(buf, 90) / 100 ;
                    res['U13'] = read3byteUInt(buf, 93) / 100 ;
                    }
                break;
            case 'SERIALNUMBER':
                res = { SN: twodigits(buf.readUInt8(1)) + twodigits(buf.readUInt8(2)) + 
                        twodigits(buf.readUInt8(3)) + twodigits(buf.readUInt8(4)) };
                break;
            case 'ACTIVEPOWER': // накопленные значения активной энергии по фазам
                res = { A1: read4byteUInt(buf, 1), A2: read4byteUInt(buf, 5), A3: read4byteUInt(buf, 9) };
                break;
            case 'REACTPOWER': // накопленные значения реактивной энергии по квадрантам
                res = { R1: read4byteUInt(buf, 1), R2: read4byteUInt(buf, 5), R3: read4byteUInt(buf, 9), R4: read4byteUInt(buf, 13) };
                break;
            case 'DAYENERGY':
                res = { Aday: (buf.readUInt16LE(1)<<16) + buf.readUInt16LE(3), Rday: (buf.readUInt16LE(9)<<16) + buf.readUInt16LE(11) };
                break;
            case 'MONTHENERGY':
                res = { Amon: (buf.readUInt16LE(1)<<16) + buf.readUInt16LE(3), Rmon: (buf.readUInt16LE(9)<<16) + buf.readUInt16LE(11) };
                break;
            case 'TIME':
                res = { Time: buf.toString('hex',3,4)+':'+buf.toString('hex',2,3)+':'+buf.toString('hex',1,2)+' '+buf.toString('hex',5,6)+'/'+buf.toString('hex',6,7)+'/'+buf.toString('hex',7,8)};
                break;
            case 'GET_TRANSFORM_COEFF':
                res = { coeff_voltage: buf.readUInt16BE(1), coeff_current: buf.readUInt16BE(3) };
                break;
            case 'ADMIN':
                res = { id: buf.readUInt8(0) }; break;
            }
        return res;
        }

    check_buf_length(cmd,buf){
        switch( cmd ){
            case 'FAST': // моментальные значения: ускоренное измерение
                if( buf.length < 89 ) return -1;
                if( buf.length === 89 ) return 0;
                if( buf.length < 98 ) return -1;
                if( buf.length === 98 ) return 0; // 98 bytes instead of 89: +linear voltage on 3 phases
                if( buf.length > 98 ) return 1;
                break;
            case 'SERIALNUMBER':
                return Math.sign(buf.length - 10);
            case 'ACTIVEPOWER': // накопленные значения активной энергии по фазам
                return Math.sign(buf.length - 15);
            case 'REACTPOWER': // накопленные значения реактивной энергии по квадрантам
                return Math.sign(buf.length - 19);
            case 'DAYENERGY':
                return Math.sign(buf.length - 19);
            case 'MONTHENERGY':
                return Math.sign(buf.length - 19);
            case 'TIME':
                return Math.sign(buf.length - 11);
            case 'GET_TRANSFORM_COEFF':
                return Math.sign(buf.length - 7);
            case 'SET_TRANSFORM_COEFF':
                return Math.sign(buf.length - 4);
            case 'ADMIN':
                return Math.sign(buf.length - 4);
            }
        }
    
    transformation_coeff_multiply( id, data ) {
        let coeff_current = this._devices_conf.get(id).coeff_current;
        data.PT *= coeff_current;       data.P1 *= coeff_current;       data.P2 *= coeff_current;       data.P3 *= coeff_current;
        data.PTsign *= coeff_current;   data.P1sign *= coeff_current;   data.P2sign *= coeff_current;   data.P3sign *= coeff_current;
        data.QT *= coeff_current;       data.Q1 *= coeff_current;       data.Q2 *= coeff_current;       data.Q3 *= coeff_current;
        data.I1 *= coeff_current;       data.I2 *= coeff_current;       data.I3 *= coeff_current;
        }

    requestcmd(dID,cmd){
        var outHex = Buffer.from([dID]).toString('hex') + cmd;
        var crcHex = ('0000'+crc16(Buffer.from(outHex,'hex')).toString(16)).slice(-4); // crc for this command
        var outgoingBuffer = Buffer.from( outHex+crcHex.substr(2,2)+crcHex.substr(0,2),'hex' );
        return outgoingBuffer;
        }
        
    }// class end

module.exports = Mercury234;


const eERROR = Symbol.for('ERROR'), eLENGTH = Symbol.for('LENGTH'), eCRC = Symbol.for('CRC'),
                eDIFFCMD = Symbol.for('DIFFCMD'), eRESPONSE = Symbol.for('RESPONSE'), eDATA = Symbol.for('DATA');
const errors_msg = {
    [eERROR]: 'Some error', 
    [eLENGTH]: 'RECEIVED bad length of data',
    [eCRC]: 'CRC FAIL',
    [eDIFFCMD]: 'Different commands',
    [eRESPONSE]: 'RECEIVED BAD response',
    [eDATA]: 'Bad encoded sensor data'
    };
function sayError(err, str, obj) {
    return {
        error: err, 
        message: str ?? errors_msg[err] ?? errors_msg[eERROR],
        data: obj
        };
    }
    
function setmonthenergy(m){
    m = Math.max(1,Math.min(m,12));
    return '053'+ m.toString(16) +'00';
    }

function twodigits(i){
    return ('00'+i).slice(-2);
    }
      
function readPowerValue(data, offset, powertype) {
    //console.log('readPowerValue');
    var p = ((data.readUInt8(offset)&0x3F) <<16) + data.readUInt16LE(offset+1);
    //      if ((data.readUInt8(offset)&0x80)!=0 && powertype=='P') { p *= -1; }
    if ((data.readUInt8(offset)&0x40)==0 && powertype=='Q') { p *= -1; }
    return p;
    }

function read_activepower_and_sign(data, offset){
    var p = ((data.readUInt8(offset)&0x3F) << 16) + data.readUInt16LE(offset+1);
    if ( (data.readUInt8(offset)&0x80) === 0 ) { return [p/100, 1]; }
    return [p/100, -1];
    }

// read 3-byte Int from the string starting from offset
function read3byteUInt(data, offset) {
    //console.log('read3byteUInt');
    return (data.readUInt8(offset) <<16) + data.readUInt16LE(offset+1);
    }

function read4byteUInt(data, offset) {
    //console.log('read4byteUInt');
    return (data.readUInt16LE(offset) <<16) + data.readUInt16LE(offset+2);
    }
  