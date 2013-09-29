var net = Npm.require('net');

/**
 * IRC Constructor
 *
 * Creates the IRC instance
 * @param params optional preferences for the connection
 */
IRC = function(params) {
  this.connection = null;
  this.buffer = '';
  this.options = {
    server: (params && params.server) || 'irc.freenode.net',
    port: (params && params.port) || 6667
  };
  this.config = {
    nick: (params && params.nick) || 'meteorirc',
    password: (params && params.password) || false,
    realname: (params && params.realName) || 'Meteor IRC',
    username: (params && params.username) || 'Meteor-IRC',
    channels: (params && params.channels) || [],
    debug: (params && params.debug) || false,
    stripColors: (params && params.stripColors) || true
  };
};

/**
 * connect
 *
 * Connects to the IRC server, sets up listeners for certain events
 */
IRC.prototype.connect = function() {
  var self = this;
  self.connection = net.createConnection(self.options.port, self.options.server, function() {
    if(self.config.debug) console.log('connecting...');
  });
  this.connection.setEncoding('utf8');

  this.connection.addListener('connect', function () {
    self.send('NICK', self.config.nick);
    self.send('USER', self.config.username, 8, "*", self.config.realname);
    self.send.apply(self, ['JOIN'].concat(self.config.channels));
  });

  //wrap in a meteor environment in order to use x.insert()
  this.connection.addListener('data', Meteor.bindEnvironment(function(chunk) {
    if(self.config.debug) console.log(chunk);
    self.buffer += chunk;
    var lines = self.buffer.split("\r\n");
    self.buffer = lines.pop();
    lines.forEach(function (dirtyLine) {
      var line = self.parseLine(dirtyLine);
      switch ( line.command ) {
        case "PING":
          self.send("PONG", line.args[0]);
          break;
        case "PRIVMSG":
          var handle = line.nick;
          var channel   = line.args[0];
          var text = line.args[1];
          //insert irc message into db
          IRCMessages.insert({
            handle: handle,
            channel: channel,
            text: text,
            date_time: new Date(),
            action: false,
            irc: true,
            bot: false
          });

          break;
        case "QUIT":
          if(self.config.debug) console.log("QUIT: " + line.prefix + " " + line.args.join(" "));
          break;
      }
    });
  }, function(e) {
    Meteor._debug("Exception from connection close callback:", e);
  }));

  this.connection.addListener('drain', function() {
    self.buffer = '';
  });

  this.connection.addListener('close', function() {
    if(this.config.debug) console.log('disconnected');
  })
};

/**
 * send
 *
 * sends a command to the irc server
 * @param command the command to send to the irc server
 */
IRC.prototype.send = function(command) {
  var args = Array.prototype.slice.call(arguments);

  if(args[args.length-1].match(/\s/) || args[args.length-1].match(/^:/) || args[args.length-1] === "") {
    args[args.length-1] = ":" + args[args.length-1];
  }

  if(this.connection) {
    this.connection.write(args.join(" ") + "\r\n");
    if(this.config.debug) console.log(args);
  }
};

/**
 * say
 *
 * a convenience method that sends a message to a channel or user
 * @param channel the channel to send to
 * @param message the message
 */
IRC.prototype.say = function(channel, message) {
  this.send('PRIVMSG', channel, message);
};

/**
 * disconnect
 *
 * disconnects from a server
 * @param msg the quit message
 */
IRC.prototype.disconnect = function(msg) {
  var message = msg || 'Powered by Meteor-IRC http://github.com/Pent/meteor-irc';
  this.send("QUIT", message);
  this.connection.close();
};

/**
 * parseLine
 *
 * transforms response from irc server into something usable
 * @param line the raw object received from the irc server
 */
IRC.prototype.parseLine = function(line) {
  var message = {};
  var match;
  var stripColors = this.config.stripColors || true;

  if (stripColors) {
    line = line.replace(/[\x02\x1f\x16\x0f]|\x03\d{0,2}(?:,\d{0,2})?/g, "");
  }

  // Parse prefix
  if ( match = line.match(/^:([^ ]+) +/) ) {
    message.prefix = match[1];
    line = line.replace(/^:[^ ]+ +/, '');
    if ( match = message.prefix.match(/^([_a-zA-Z0-9\[\]\\`^{}|-]*)(!([^@]+)@(.*))?$/) ) {
      message.nick = match[1];
      message.user = match[3];
      message.host = match[4];
    }
    else {
      message.server = message.prefix;
    }
  }

  // Parse command
  match = line.match(/^([^ ]+) */);
  message.command = match[1];
  message.rawCommand = match[1];
  message.commandType = 'normal';
  line = line.replace(/^[^ ]+ +/, '');

  message.args = [];
  var middle, trailing;

  // Parse parameters
  if ( line.search(/^:|\s+:/) != -1 ) {
    match = line.match(/(.*?)(?:^:|\s+:)(.*)/);
    middle = match[1].trimRight();
    trailing = match[2];
  }
  else {
    middle = line;
  }

  if ( middle.length )
    message.args = middle.split(/ +/);

  if ( typeof(trailing) != 'undefined' && trailing.length )
    message.args.push(trailing);

  return message;
};