"use strict";

var packets = require ("../packets");
var opcodes = require ("../opcodes");
var errors = require ("../errors");
var Retransmitter = require ("../retransmitter");

var Request = module.exports = function (args){
  this._isRRQ = !args.reader;
  this._socket = args.socket;
  this._globalOptions = args.globalOptions;
  this._timeout = this._globalOptions.extensions.timeout;
  this._closed = false;
  this._closing = false;
  this._aborted = false;
  this._retransmitter = this._createRetransmitter ();
  this._maxDataLength = 4;
  this._file = args.message.file;
  this._size = args.size;
  this._userExtensions = args.message.userExtensions;
  this._oackSent = false;
  
  this._socket.socket
      .on ("message", function (message, rinfo){
        me._onMessage (message);
      })
      .on ("error", function (error){
        me._closed = true;
        //me._retransmitter.reset ();
      })
      .on ("close", function (){console.log("SERVER END")
        me._closed = true;
        //me._retransmitter.reset ();
        if (me._aborted) return me._onAbort ();
        if (me._error){
          me._onError (me._error);
        }else{
          //Transfer ended successfully
          me._onClose ();
        }
      });
  
  //Delay the response to the next tick to allow the reader and writer to
  //initialize correctly
  var me = this;
  process.nextTick (function (){
    if (args.message.extensions === null){
      //The client doesn't support extensions
      //The socket is still not bound to an address and port because no packet
      //is still sent, so the stats cannot be emitted yet (the call to address()
      //fails)
      //The socket must be bound manually
      me._socket.socket.bind (0, null, function (){
        me._onReady (me._createStats (512, 1));
      });
    }else{
      //Send OACK
      
    }
  });
};

Request.prototype.abort = function (message){
  if (this._closed || this._closing || this._aborted) return;
  this._aborted = true;
  this._sendErrorAndClose (message || errors.EABORT);
};

Request.prototype._close = function (error){
  if (this._closed || this._closing) return;
  //If multiples closes occur inside the same tick (because abort() is called),
  //the socket throws the error "Not running" because the socket is already
  //closed, this is why there's a closing flag. There are 2 possible cases:
  //- (1) abort close, (2) socket close
  //- (1) socket close, (2) abort close
  //If it's the first case, the second close() is ignored because the request
  //is aborted just before
  //If it's the second case, the second abort() it's useless because the request
  //is already closed
  this._closing = true;
  
  //Store the error after the flag is set to true, otherwise the error could be
  //used by another close()
  if (error) this._error = error;
  
  var me = this;
  //Close in the next tick to allow sending files in the same tick
  process.nextTick (function (){
    me._socket.socket.close ();
  });
};

Request.prototype._createStats = function (blockSize, windowSize){
  //Save max data length
  this._maxDataLength += blockSize;
  
  var address = this._socket.socket.address ();
  
  return {
    blockSize: blockSize,
    windowSize: windowSize,
    rollover: 0,
    size: this._size,
    timeout: this._timeout,
    userExtensions: this._userExtensions,
    localSocket: {
      address: address.address,
      port: address.port
    },
    remoteSocket: {
      address: this._socket.address,
      port: this._socket.port
    },
    file: this._file,
    retries: this._globalOptions.retries
  };
};

Request.prototype._onMessage = function (buffer){
  var op = buffer.readUInt16BE (0);
  
  if (op === opcodes.RRQ || op === opcodes.WRQ || op === opcodes.OACK){
    this._sendErrorAndClose (errors.EBADOP);
  }else if (op === opcodes.DATA){
    if (!this._isRRQ){
      /*if (!this._extensionsEmitted) this._emitDefaultExtensions ();
      if (buffer.length < 4 || buffer.length > this._maxDataLength){
        return this._sendErrorAndClose (errors.EBADMSG);
      }
      this._onData (packets.data.deserialize (buffer));*/
    }else{
      this._sendErrorAndClose (errors.EBADOP);
    }
  }else if (op === opcodes.ACK){
    if (this._isRRQ){
      if (buffer.length !== 4){
        return this._sendErrorAndClose (errors.EBADMSG);
      }
      if (this._oackSent){
        this._oackSent = false;
        //The first ACK with block 0 is ignored
        if (buffer.readUInt16BE (2) !== 0){
          this._sendErrorAndClose (errors.EBADMSG);
        }
      }else{
        this._onAck (packets.ack.deserialize (buffer));
      }
    }else{
      this._sendErrorAndClose (errors.EBADOP);
    }
  }else if (op === opcodes.ERROR){
    if (buffer.length <= 4) return this._closeWithError (errors.EBADMSG);
    try{
      buffer = packets.error.deserialize (buffer);
    }catch (error){
      return this._closeWithError (error);
    }
    this._close (new Error ("(Client) " + buffer.message));
  }else{
    //Unknown opcode
    this._sendErrorAndClose (errors.EBADOP);
  }
};

Request.prototype._sendAck = function (block){//console.log(">> " + block)
  this._send (packets.ack.serialize (block));
};

Request.prototype._sendBlock = function (block, buffer){console.log(">> " + block)
  this._send (packets.data.serialize (block, buffer));
};

Request.prototype._sendErrorAndClose = function (code){
  var message;
  if (typeof code === "number"){
    message = errors.rfc[code];
  }else{
    message = code;
  }
  this._send (packets.error.serialize (code));
  this._close (new Error ("(Client) " + message));
};

Request.prototype._closeWithError = function (code){
  var message;
  if (typeof code === "number"){
    message = errors.rfc[code];
  }else{
    message = code;
  }
  this._close (new Error ("(Server) " + message));
};

Request.prototype._sendAndRetransmit = function (buffer){
  this._send (buffer);
  var me = this;
  this._retransmitter.start (function (){
    me._send (buffer);
  });
};

Request.prototype._send = function (buffer){
  if (this._closed) return;
  this._socket.socket.send (buffer, 0, buffer.length, this._socket.port,
      this._socket.address);
};

Request.prototype._createRetransmitter = function (){
  return new Retransmitter (this);
};