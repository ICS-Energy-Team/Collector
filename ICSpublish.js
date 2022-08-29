'use strict';

const https = require('https');
const http = require('http');
const mqtt = require('mqtt');

const rfs = require("rotating-file-stream");

class Publisher{

    constructor(config){
        var iotservers = config.iotservers;
        let self = this;
        iotservers.forEach(function(iotserver){
            if( iotserver.type == 'file' )
                {
                self._name = iotserver.name || config.configname;
                var compressvar = iotserver.compress || "gzip";
                var ext = 'log';
                if ( compressvar === "gzip" ) ext += '.gz';
                self._stream = rfs.createStream(`${self._name}.`+ext, {
                    interval: iotserver.interval || "1d", // rotate daily
                    maxFiles: iotserver.maxFiles || 15, // rotate 2+ weeks
                    compress: compressvar // compress rotated files
                    });
                }
            },this);
        
        /* for 'filesystem' IoT server :) */
        //const FileDump = {
        //    timer: 60000,//3600000, // hour in msec
        //    datainterval: 1, //sec
        //    devicescount: 30,
        this._overcount = 50;
        this._count = 1000;
        this._arrayLen = this._count; //FileDump.overcount
                        //+ Math.ceil(FileDump.timer/1000 / FileDump.datainterval) * FileDump.devicescount;
        this._dataArray = new Array(this._arrayLen);
        this._elem = 0;//, period = 0;        //var startts;

        this._devices = {};
        this._GreenPL = {};
        this._mqttclients = { count: 0, ended: 0 };
        
        // for human datetime
        this._moscowdate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'Europe/Moscow', hour12: false });
        }
        
    async sendevent(iotservers, devEui, datatosend) {
        var json = JSON.stringify(datatosend,null,2);
        var valuesjson = JSON.stringify(datatosend.values,null,2);
        //console.log('Device ID ' + devEui +': data "'  + json + '" sent to: \n');
        console.log('Device ID ' + devEui +' with timestamp '  + datatosend.ts + ' sent to:');
        let self = this;

        //for all destinations
        iotservers.forEach(function(iotserver) {
          // assign destination server and port from runtime parameters with TB cloud as default
          if (iotserver.type == 'file'){
              //if( elem == 0 ) startts = datatosend.ts;
              self._dataArray[self._elem] = datatosend;
              self._elem++;
              //if( datatosend.ts - startts > FileDump.timer ){
              if( self._elem > self._arrayLen - self._overcount ){
                self.saveToFile( self._dataArray.slice(0,self._elem) );
                self._elem = 0;
                }
          } else if (iotserver.type == 'node-red') { // for node-red assume MQTT
            if ( self._devices.hasOwnProperty('node-red') ){
              self._devices['node-red'].connector.publish(iotserver.topic, json, function(err){
                  if(err) {
                      var cli_str = "mqclientid "+ 'node-red';
                      console.log( cli_str + ", Cann't publish to node-red TB, error:" + err);
                      }
                  });
            } else {
                let mqclient = mqtt.connect('mqtt://'+iotserver.host+':'+iotserver.port);
                self._devices['node-red'] = { connector:mqclient, data:datatosend };
                var loc_mqttclients = self._mqttclients;
                var loc_devices = self._devices;
                mqclient.on('connect', function (topic, message) {
                  loc_mqttclients.count += 1;
                  console.log('node-red says connect.', ' mqtt clients counts: ' + JSON.stringify(loc_mqttclients));
                  mqclient.publish(iotserver.topic,json,function(err){
                    if(err) console.log("cann't publish on node-red, err:" + err );
                    mqclient.removeAllListeners('connect');
                    mqclient.on('connect',()=>{console.log('node-red says connect, '+strClientId);});
                    });
                  });
                mqclient.on('message', function (topic, message) {
                  console.log('Response from node-red server: '+ message.toString());
                  });
                mqclient.on('error', function (error) {
                  console.log('Could not connect to node-red server with error: '+error);
                  console.log('Flush MQTT channel to node-red server');
                  loc_mqttclients.ended += 1;
                  mqclient.end();
                  delete loc_devices['node-red'];
                  });
             }
             console.log('  mqtt on node-red server')

          } else if (iotserver.type == 'rightech') { // for rightech assume MQTT
              console.log('Rightech server by MQTT...');
              let mqclient = mqtt.connect('mqtt://'+iotserver.host+':'+iotserver.port, {clientId: devEui});

              mqclient.on('connect', function () {
                mqclient.publish('telemetry', valuesjson);
                mqclient.end();
                });

              mqclient.on('message', function (topic, message) {
                // message is Buffer
                console.log('Response from rightech server: '+ message.toString());
                mqclient.end();
                });
              mqclient.on('error', function (error) {
                console.log('Could not connect to rightech server with error: "'+error+'"');
                console.log('Flush MQTT channel to rightech server');
                mqclient.end();
                });
          } else if (iotserver.type == 'thingsboard') {
              let devToken = devEui;

              let teleoptions = {
                  host: iotserver.host,
                  port: iotserver.port,
                  path: '/api/v1/' + devToken + '/telemetry',
                  method: 'POST'
                  };

              let devID = teleoptions.host +'/'+ devToken;

            if( iotserver.protocol == 'mqtt' ) {
                if ( self._devices.hasOwnProperty(devID) ){
                  self._devices[devID].sendalltime = datatosend.ts;
                  self._devices[devID].connector.publish('v1/devices/me/telemetry', json, function(err){
                      if(err) {
                          var cli_str = "mqclientid "+ self._devices[devID].connector.options.clientId;
                          console.log( cli_str + ", Cann't publish to TB, error:" + err);
                          }
                      });

                    /*// code for data economy when measurements doesn't change
                    if( datatosend.ts - devices[devToken].sendalltime >= iotserver.maxSilenceTime ){
                        devices[devToken].sendalltime = datatosend.ts;
                        let repeatdata = devices[devToken].data;
                        devices[devToken].connector.publish('v1/devices/me/telemetry',JSON.stringify(repeatdata,null,2));
                        devices[devToken].connector.publish('v1/devices/me/telemetry',json);
                    } else {
                        [chg,notchg] = getChangedAttributes(datatosend.values,devices[devToken].data.values);
                        if( chg.length != 0 ){
                          smalljson = JSON.stringify(datatosend.values,chg,2);
                          smalljson += '}';
                          smalljson = '{"ts":'+datatosend.ts+',  "values":'+smalljson;
                          devices[devToken].connector.publish('v1/devices/me/telemetry',smalljson);
                        }
                    }*/
                    self._devices[devID].data = datatosend;
                } else {
                    let mqclient = mqtt.connect('mqtt://'+iotserver.host+':'+iotserver.port, {username: devToken});
                    let strClientId = 'mqclientid '+ mqclient.options.clientId;
                    self._devices[devID] = { connector:mqclient, data:datatosend, sendalltime:datatosend.ts };
                    var loc_mqttclients = self._mqttclients;
                    var loc_devices = self._devices;
                    /*mqclient.on('connect', function () {
                      mqclient.publish('v1/devices/me/telemetry',json);
                      mqclient.on('connect',function(){});
                    });*/
                    mqclient.on('connect', function (topic, message) {
                      loc_mqttclients.count += 1;
                      console.log('thingsboard says connect, ' + strClientId, 'mqtt clients counts: ' + JSON.stringify(loc_mqttclients));
                      mqclient.publish('v1/devices/me/telemetry',json,function(err){
                        if(err) console.log("cann't publish on thingsboard, err:" + err );
                        mqclient.removeAllListeners('connect');
                        mqclient.on('connect',()=>{console.log('thingsboard says connect, '+strClientId);});
                        });
                      });
                    mqclient.on('message', function (topic, message) {
                      console.log('Response from thingsboard server: '+ message.toString());
                      });
                    mqclient.on('error', function (error) {
                      console.log(strClientId + ', Could not connect to thingsboard server with error: '+error);
                      console.log('Flush MQTT channel to thingsboard server');
                      loc_mqttclients.ended += 1;
                      mqclient.end();
                      delete loc_devices[devID];
                      });
                    /*mqclient.on('reconnect', function () {
                      console.log('thingsboard says reconnect, we say good bye, mqclientid '+ mqclient.options.clientId);
                      mqclient.end();
                      delete devices[devID];
                      });*/
                    /*mqclient.on('end', function () {//'end' is about client.end()!
                      console.log('thingsboard says end, mqclientid '+ mqclient.options.clientId);
                      mqclient.end();
                      delete devices[devID];
                      });*/
                    mqclient.on('offline', function () {
                      console.log('thingsboard says offline, '+ strClientId);
                      //mqclient.end();
                      //delete devices[devID];
                      });
                    mqclient.on('disconnect', function (p) {
                      console.log(strClientId + ', thingsboard says disconnect '+p);
                      //mqclient.end();
                      //delete devices[devID];
                      });
                    mqclient.on('close', function () {
                      console.log('thingsboard says close, '+ strClientId);
                      loc_mqttclients.ended += 1;
                      mqclient.end();
                      delete loc_devices[devID];
                      });
                }
            } else if (iotserver.protocol == 'https') {
                let telereq = https.request(teleoptions, function(res) {
                    if (res.statusCode >= 300) {
                        console.log('TB tele err');
                        console.log('STATUS: ' + res.statusCode);
                        console.log('HEADERS: ' + JSON.stringify(res.headers));
                        res.setEncoding('utf8');
                        res.on('data', function(chunk) {
                            console.log('BODY: ' + chunk);
                        });
                    } else {
                        //console.log('OK');
                    };
                });
                telereq.on('error', function(e) {
                    console.log('Problem with telemetry request: ' + e.message);
                });
                telereq.end(json);
            } else if ( iotserver.protocol == 'http' ){
                let telereq = http.request(teleoptions, function(res) {
                    if (res.statusCode >= 300) {
                        console.log('TB tele err');
                        console.log('STATUS: ' + res.statusCode);
                        console.log('HEADERS: ' + JSON.stringify(res.headers));
                        res.setEncoding('utf8');
                        res.on('data', function(chunk) {
                            console.log('BODY: ' + chunk);
                        });
                    } else {
                        //console.log('OK');
                    };
                });
                telereq.on('error', function(e) {
                    console.log('Problem with telemetry request: ' + e.message);
                });
                telereq.end(json);
            };
            //attreq.write(valuesjson);
            //attreq.end(valuesjson);
            //telereq.write(json);
            console.log('  ' + iotserver.type + ' server at ' + iotserver.host + ":" + iotserver.port);
          } else if (iotserver.type == 'azure') {
            let AzureConnectionString = 'HostName='+iotserver.host+'.azure-devices.net;DeviceId='+devEui+';SharedAccessKey='+devEui+devEui;
            console.log('Sending to Azure ' +AzureConnectionString);
            let AzureMqtt = require('azure-iot-device-mqtt').Mqtt;
            let AzureDeviceClient = require('azure-iot-device').Client;
            let AzureMessage = require('azure-iot-device').Message;
            let AzureClient = AzureDeviceClient.fromConnectionString(AzureConnectionString, AzureMqtt);
            let message = new AzureMessage(json);
            AzureClient.sendEvent(message, function (err) {
                if (err) {
                  console.error('send error: ' + err.toString());
                } else {
                  //console.log('message sent');
                }
            });
            AzureClient.close(function (err) {
                if (err) {
                  console.error('close error: ' + err.toString());
                } else {
                  //console.log('mqtt to azure server closed');
                }
            });
          } else if (iotserver.type == 'greenpl'){
              console.log("  Sending to GreenPL (host:" + iotserver.host + ")");
              if ( self._GreenPL.hasOwnProperty('client') ){
                self._GreenPL.client.publish('/devices/' + devEui, valuesjson, {"qos": 1, "retain": false},
                    function (error, response) {
                        // print response to console
                        console.log(response);
                        // if function was returned error then we printing this error to console
                        if (error) { console.log(error); }
                    });
              } else {
                self._GreenPL.client = mqtt.connect('mqtt://' + iotserver.host,
                    {username:iotserver.token, password:'1'}
                    );
                    self._GreenPL.client.on('connect', function () {
                  console.log('GreenPL says connect');
                  GreenPL.client.publish('/devices/' + devEui, valuesjson, {"qos": 1, "retain": false},
                      function (error, response) {
                          // print response to console
                          console.log(response);
                          // if function was returned error then we printing this error to console
                          if (error) { console.log(error); }
                          });
                      });

                self._GreenPL.client.on('message', function (topic, message) {
                  console.log('Response from GreenPL server: '+ message.toString());
                  });
                self._GreenPL.client.on('error', function (error) {
                  console.log('Could not connect to GreenPL server with error: "'+error+'"');
                  console.log('Flush MQTT channel to GreenPL server');
                  self._GreenPL.client.end();
                  delete self._GreenPL['client'];
                });
                self._GreenPL.client.on('offline', function () {
                  console.log('GreenPL says offline');
                  });
                self._GreenPL.client.on('disconnect', function (p) {
                  console.log('GreenPL says disconnect '+p);
                  });
                self._GreenPL.client.on('close', function () {
                  console.log('GreenPL says close');
                  if ( self._GreenPL.hasOwnProperty('client') ){
                    self._GreenPL.client.end();
                    delete self._GreenPL['client'];
                    }
                  });
              }
          } else {
              console.log('! Unknown IoT server type ' + iotserver.type);
          }
        },this);//iotservers.forEach
    } // sendevent

    closeconnectors()
        {
        this._stream.end();
        Object.entries(this._devices).forEach(([k,v])=>{
            v.connector.end();
            });
        this._devices = {};
        }

    async saveToFile (data) 
        {
        if ( typeof this._stream === "undefined" ) return;
        var json = JSON.stringify(data) + ',\n';
        this._stream.write(json, (err) => {
            if (err) return console.log(err);
            console.log('The file has been saved.');
            });
        }
        
    } // class Publisher

module.exports = Publisher;  

function getChangedAttributes(newdata,olddata){
  var changed = [];
  var notchanged = [];
  Object.entries(newdata).forEach(([k,v])=>{
    if( olddata.hasOwnProperty(k) ){
      if( v != olddata[k] ){
        changed.push(k);
      } else {
        notchanged.push(k);
      }
    } else { changed.push(k); }
  });
  return [changed,notchanged];
}

/*function getChangedAttributes(newdata,olddata,maxsilence){
  changed = [];
  notchanged = [];
  var oldvalues = olddata.values;
  Object.entries(newdata.values).forEach(([k,v])=>{
    if( olddata.hasOwnProperty(k) ){
      if( v != olddata[k] ){
        changed.push(k);
      } else {
        notchanged.push(k);
      }
    } else { changed.push(k); }
  });
  for( let i = 0 ; i < blacklist.length ; i++ ){
    if( newdata.ts - olddata.ts >= maxsilence  ){

    }
  }

  return [changed,notchanged];
}
/*
if( iotserver.protocol == 'mqtt' ) {
    if ( devices.hasOwnProperty(devToken) ){
        if( datatosend.ts - devices[devToken].sendalltime >= iotserver.maxSilenceTime ){
            let repeatdata = devices[devToken].
            devices[devToken].connector.publish('v1/devices/me/telemetry',JSON)
            devices[devToken].connector.publish('v1/devices/me/telemetry',json);
            devices[devToken].data = datatosend;
        }
        [chng,notchng] = getChangedAttributes(datatosend,devices[devToken].data,iotserver.maxSilenceTime);
        if( chng.length != 0 ){
          smalljson = JSON.stringify(datatosend.values,chng,2);
          smalljson += '}';
          smalljson = '{"ts":'+datatosend.ts+',  "values":'+smalljson;
          devices[devToken].connector.publish('v1/devices/me/telemetry',smalljson);
          for(let i = 0 ; i < chng.length ; i++ ){
              devices[devToken].data[chng[i]] = { ts: datatosend.ts, value: datatosend.values[chng[i]] };
          }
        }
        devices[devToken].lasttime = datatosend.ts;
    } else {

*/
