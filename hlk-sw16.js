var net = require("net");

module.exports = function (RED) {
  function hlksw16(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    var nodeContext = this.context();
    ///////////////////////////////////
    
    // Init net client
    var tcpClient = new net.Socket();
    tcpClient.connect(config.port, config.ip, function () {
      node.status({fill:"green",shape:"dot",text:"connected"});
      console.log(
        "Connected to relay board: " + config.ip + " tcp" + config.port
      );
    });

    const sndHead = 0xaa,
      sndTail = 0xbb,
      recHead = 0xcc,
      recTail = 0xdd,
      cmdChgStateOne = 0x0f,
      cmdChgStateAllOn = 0x0a,
      cmdChgStateAllOff = 0x0b,
      cmdReqStatAll = 0x1e,
      relOn = 0x01,
      relOff = 0x02;

    // Initialise packet (20 bytes) variable as a Buffer
    var initPacket = Buffer.alloc(20, 0x00);

    // Func to format send tcp packet
    function initSendPacket(buf) {
      buf[0] = sndHead;
      buf[19] = sndTail;
      return buf;
    }

    // Func to change state of single relay
    function singleRelayChgState(state, relay) {
      let relayStr = relay.toString()
      var tcpPacket = initSendPacket(initPacket);
      tcpPacket[1] = cmdChgStateOne;
      tcpPacket[2] = relayStr.toString("hex");
      if (state === false) {
        tcpPacket[3] = relOff;
      } else if (state === true) {
        tcpPacket[3] = relOn;
      }
      tcpClient.write(tcpPacket);
      console.log("Send data to board: " + tcpPacket.toString("hex"));
    }

    // Func to change state of all relays
    function allRelayChgState(state) {
      var tcpPacket = initSendPacket(initPacket);
      if (state == "0" || state == "OFF") {
        tcpPacket[1] = cmdChgStateAllOff;
      } else if (state == "1" || state == "ON") {
        tcpPacket[1] = cmdChgStateAllOn;
      }
      tcpClient.write(tcpPacket);
      console.log("Send data to board: " + tcpPacket.toString("hex"));
    }

    // Func to request state of relays on device and publish this state on mqtt topic
    function allRelayReqState() {
      var tcpPacket = initSendPacket(initPacket);
      tcpPacket[1] = cmdReqStatAll;
      tcpClient.write(tcpPacket);
      console.log("Send data to board: " + tcpPacket.toString("hex"));
    }

    //Func to end connection to board
    function disconnectTcpClient() {
      tcpClient.end();
      tcpClient.destroy();
      tcpClient.unref();
      node.status({fill:"red",shape:"ring",text:"disconnected"});
    }

    
    

    // Handle TCP event DATA
    tcpClient.on("data", function (data) {
      let recMsg = data.toString("hex")
      let req = nodeContext.get('msg')
      if(req !== undefined){
        if(recMsg.startsWith('cc0c')){
          let onlyRelayData = recMsg.substring(4,36);
          let relayStatus = []
          for (let rindex = 0; rindex < 31; rindex+=2) {
            const status = onlyRelayData[rindex]+onlyRelayData[rindex+1];
            if((rindex/2) == req.payload){
              relayStatus.push({relay: rindex/2, status: status === '01' ? true : false})
            }
          }
          node.send({payload:relayStatus})
        }
      }

      var checksum = 0;
      for (i = 1; i < 18; i++) {
        checksum += data[i];
      }
      // Something is wrong with checksum (Calc chksum + 2 = Rec chksum ?????)
      console.log(
        "Calculated checksum: " +
          checksum.toString(16) +
          " - Received checsum: " +
          data[18].toString(16)
      );
    });
    tcpClient.on('error', function (err) {
      console.error(err)
      disconnectTcpClient()
    })
    tcpClient.on('end', function () {
      console.log('connection ended')
    })
    tcpClient.on('timeout', function () {
      disconnectTcpClient()
    })
    ///////////////////////////////////
    node.on("input", function (msg, send, done) {
      console.log(msg)
      if(!msg.payload){return}
      if(msg.action === undefined && msg.status === undefined){return}

      if(typeof msg.payload !== 'number'){return}
      if(msg.action !== undefined && typeof msg.action !== 'boolean'){return}
      if(msg.status !== undefined && typeof msg.status !== 'boolean'){return}

      if(msg.payload < 1 || msg.payload > 16){return}
      
      nodeContext.set('msg', msg)

      if (msg.status === true) {
        allRelayReqState();
      } 
      
      if(msg.action !== undefined){
        singleRelayChgState(msg.action, msg.payload-1);
      }
      if(done){
        done();
      }
    });

    node.on("close", function (removed, done) {
      disconnectTcpClient();
      done();
    });
  }
  RED.nodes.registerType("hlk-sw16", hlksw16);
};
