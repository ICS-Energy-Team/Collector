// @ts-check
'use strict';

const crc16 = require('crc').crc16modbus;

/*
  Meteostation Sokol-M simple payload decoder.
  Use it as it is or remove the bugs :)
  vkorepanov@ipu.ru
*/

// Now only for command 63h
class MeteoSokol{
    constructor(device){
        this._version = "MeteoMonitor v. 0.9 for Meteostation Sokol-M";
        this._versiondate = "05 Feb 2022";
        this.request = this._request;
        this.parse = this._parseAnswer;
        this.active = false;
        this.message = requestcmd(device.netaddress);
        }

    _request(){
        return this.message;
        }
    /**
     * @param {{ length: number; readInt16BE: (arg0: number) => number; readUInt16BE: (arg0: number) => number; }} buf
     */
    _parseAnswer(buf){
        var info = {};
        try{
        for ( let i = 9 ; i < buf.length ; i++ ) {
            switch (i) {
                case 0: // device address
                case 1: // command code
                case 2: // bytes in load
                case 3: // errors, type, ...
                case 4: // firmware version
                case 5: // UNIX time...
                case 6: // UNIX time...
                case 7: // UNIX time...
                case 8: // UNIX time...
                    break;
                case 9:
                    info.temperature = buf.readInt16BE(i) / 100; // C
                    i++; break;
                case 11:
                    info.pressure = buf.readUInt16BE(i) * 10; // Pa
                    i++; break;
                case 13:
                    info.humidity = buf.readUInt16BE(i); // %
                    i++; break;
                case 15:
                    info.windspeed = buf.readUInt16BE(i) / 100; // m/s
                    i++; break;
                case 17:
                    info.winddirection = buf.readUInt16BE(i); // degree
                    i++; break;
                case 19:
                    info.rainfall = buf.readUInt16BE(i) / 10; // mm
                    i++; break;
                case 21:
                    info.ultraviolet = buf.readUInt16BE(i) / 100 ; // W/m^2
                    i++; break;
                case 23:
                    info.illumination = buf.readUInt16BE(i) ; // 1 lux
                    i++; break;
            }
        }}
        catch(e){
            console.error('Error in MeteoSokolparser._parseAnswer while parsing data from SOKOL meteostation');
            console.error(e);
            }
        return info;
        }
    
    }

/**
 * @param {number} id
 */
function requestcmd(id){
    var buf = Buffer.from([id, 0x03,0x00,0x00,0x00,0x0C, 0x00,0x00]);
    var vcrc = crc16(buf.slice(0, buf.length-2));
    buf.writeUInt16LE(vcrc, buf.length-2);
    return buf;
    }
    
module.exports = MeteoSokol;