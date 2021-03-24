'use strict';

const crc16 = require('crc').crc16modbus;

/*
  Mercury206 simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

// Now only for command 63h
class Mercury206{
    constructor(moxa){
        // 2F - чтение серийного номера
        // 26h - активная мощность в нагрузке
        // 63h = 99d - Чтение значений U,I,P
        // 81h - Чтение доп. параметров сети (частота) и текущего тарифа
        this._commands = {'SERIALNUM': '2F', 'VCP': '63'};
        this._parsers = { 99: this._parseVCP }; // 63h = 99d
        this._version = "MercuryMonitor v. 0.9 for Mercury 206";
        this._versiondate = "23 Dec 2020";
        this._moxa = moxa;
        this._alldevices = moxa.Mercury206.devices; // [{active:true,ID:<..>}, ...]
        this._devices = moxa.Mercury206.devices.filter(function(v){return v.active;});
        this._i = -1;
        this.request = this._request;
        this.parse = this._parseAnswer;
        }

    _request(){
        this._i += 1;
        if( this._i >= this._devices.length ) {
            this._i = -1;
            return "END";
            }

        let d = this._devices[this._i].ID;
        //console.log( "Mercury206_id" + d );
        return {request: this._requeststring(d), timeout: this._moxa.Mercury206.timeout};
        }

    _requeststring(dID){
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32BE(dID,0);

        var outHex = buf.toString('hex') + this._commands['VCP'];
        var crcHex = ('0000'+crc16(Buffer.from(outHex,'hex')).toString(16)).slice(-4); // crc for this command
        var outgoingMessage = Buffer.from(outHex+crcHex.substr(2,2)+crcHex.substr(0,2),'hex');
        return outgoingMessage;
        }
    _parseAnswer(buf){
        var dID = buf.readUInt32BE(0);
        if( buf.length < 5 ) return sayError(RESPLESS5,'Mercury206parser',buf);
        var cmd = buf.readUInt8(4);
        return {
            devEui: (this._moxa.name + '-206-' + dID).slice(-20), 
            values: this._parsers[cmd](buf), 
            timeout: this._moxa.Mercury206.timeout
            };
        }
    _parseVCP(buf){
        /* // variant 1
        var U = (buf.readUInt8(5)>>>4) * 100;
        var a1 = buf.readUInt8(6);
        U += (a1&0x0F)*10;
        U += a1>>>4;

        var I = (buf.readUInt8(7)>>>4) * 100;
        a1 = buf.readUInt8(8);
        I += (a1&0x0F)*10;
        I += a1>>>4;

        var P = (buf.readUInt8(9)>>>4) * 10000;
        a1 = buf.readUInt8(10);
        P += (a1&0x0F)*1000;
        P += (a1>>>4)*100;
        a1 = buf.readUInt8(11);
        P += (a1&0x0F)*10;
        P += a1>>>4;
        */

        // variant 2:  https://github.com/sergray/energy-meter-mercury206
        var V = parseFloat(buf.toString('hex',5,7)) / 10;
        var I = parseFloat(buf.toString('hex',7,9)) / 100;
        var P = parseFloat(buf.toString('hex',9,12)) / 1000;
        return {"V": V, "I": I, "P": P};
        }
}

const RESPLESS5 = 0;
var myerrors = {};
myerrors[RESPLESS5] = 'RECEIVED response of length < 5';

function sayError(i, str, obj) {
    if( i < 0 || i >= myerrors.length ) return;
    if( typeof str === "undefined" ) str = '';
    var a = {error: myerrors[i], message: str};
    if( typeof obj !== "undefined" ) a.data = obj;
    return a;
    }    

module.exports = Mercury206;

/*// answer to 63h command
    > ask(DeviceIDs[1]);
    WROTE: 027cf85b63beb8
    undefined
// answer: ADDR CMD U-I-P CRC
    > 027cf85b 63 2142 0000 000000 7b53
                  2153 0000 000001
                  2157
                  2141
                  2150
                  2147
                  2174
              4221 = 0100 0010 0010 0001
              5321 = 0101 0011 0010 0001
              5721 = 0101 0111 0010 0001
              7421 = 0111 0100 0010 0001

0010 0001 0100 0010 = 214,2
0010 0001 0101 0011 = 215,3
0010 0001 0101 0111 = 215,7
0010 0001 0111 0100 = 217,4*/
