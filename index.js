const config = require("./config.json");
const prefix = config.prefix;

const Discord = require("discord.js");
const client = new Discord.Client();

const { EventEmitter } = require("events");
const emitter = new EventEmitter();

const fs = require('fs');

const low = require('lowdb');
const AwsAdapter = require('lowdb-adapter-aws-s3');

const adapter = new AwsAdapter('db.json', { aws: { bucketName: config.bucketName } });

const ms = require('millisecond');
const pretty_ms = require('pretty-ms');

const ytdl = require("ytdl-core-discord");
const http = require("https");
const request = require('request');


var muteTimers = {};
var welcomeMessageId = "";
var queue = [];
var repeat = false;

client.once("ready", async () => {
    fs.readFile('./RULES.txt', 'utf-8', (err, data) => {
        config.rules = data;
    })
    db = await low(adapter);
    console.log("Ready");
    client.user.setPresence(config.status);
    client.channels.fetch(config.channels.rules).then(rulesChannel => {
        rulesChannel.messages.fetch({ limit: 1 }).then(msgs => {
            if (msgs.first()) {
                welcomeMessageId = msgs.first().id;
            } else {
                rulesChannel.send(config.rules).then(msg => {
                    msg.react('✅');
                    welcomeMessageId = msg.id;
                });
            }
        });
    });
    updateGuildDefualts();
    setInterval(async () => {
        const guild = client.guilds.resolve(config.guildId);
        if (guild.available) {
            var count = 0;
            for (channel of guild.channels.cache.array()) {
                const time = db.get(`channels.${channel.id}`).value().time;
                if (time === 0) {
                    continue;
                }
                if (!(channel instanceof Discord.TextChannel)) {
                    continue;
                }
                const messages = await channel.messages.fetch();
                for (message of messages.array()) {
                    if (message.pinned) {
                        continue;
                    }
                    const diff = (Date.now() - message.createdAt)/60000;
                    if (diff > time) {
                        count++;
                        message.delete();
                    }
                }
            }
            console.log(`Cleaned ${count} messages`);
        }
    }, 60000)
});

client.once("guildMemberAdd", member => {
    updateGuildDefualts();
});

function updateGuildDefualts() {
    const guild = client.guilds.resolve(config.guildId);
    if (guild.available) {
        guild.members.fetch().then(members => {
            var userInfo = {};
            for (const userId of Array.from(members.keys())) {
                if (!members.get(userId).bot) {
                    userInfo[userId] = {
                        "perms": []
                    }
                }
            }
            var roleInfo = {};
            for (const roleId of Array.from(guild.roles.cache.keys())) {
                roleInfo[roleId] = {
                    "perms": []
                }
            }
            var channelInfo = {};
            for (const channelId of Array.from(guild.channels.cache.keys())) {
                channelInfo[channelId] = {
                    "time": 0
                }
            }
            db.defaultsDeep({
                'users': userInfo,
                'roles': roleInfo,
                'channels': channelInfo
            }).write();
        })
    }
}

client.on("messageReactionAdd", function(reaction, user){
    if (reaction.message.id === welcomeMessageId && !user.bot) {
        reaction.users.remove(user.id);
        reaction.message.guild.roles.fetch(config.roles.general).then(role => {
            reaction.message.guild.members.fetch(user).then(member => {
                member.roles.add(role);
            });
        });
    }
});

client.on("message", message => {
    if (!message.content.startsWith(prefix) | message.author.bot) return;
    handleCommand(message.content.substring(1).split(" ")[0], message);
})

function handleCommand(name, message) {
    console.log(`Recieved Command: ${message}`);
    switch (name) {
        case "help":
            return help(message);
        case "stats":
            return message.channel.send(`Server Members: ${ message.guild.memberCount }`);
        case "play":
            if (message.content.split(' ').length === 1) {
                return message.channel.send(`Please enter all arguments correctly:\n\`\`\`${config.prefix}play <song>\n${config.prefix}play <spotify playlist url> [shuffle:yes/no] [limit]\`\`\``)
            }
            return queueSong(message);
        case "stop":
            emitter.emit("stop");
            return;
        case "pause":
            emitter.emit("pause");
            return;
        case "resume":
            emitter.emit("resume");
            return;
        case "skip":
            emitter.emit("skip");
            return;
        case "perms":
            return permsCommand(message);
        case "mute":
            return mute(message);
        case "unmute":
            return unmute(message);
        case "queue":
            if (queue.length == 0) {
                return message.channel.send("Nothing currently queued.");
            }
            for (song of queue) {
                if (song == queue[0]) {
                    message.channel.send({ embed: nowPlayingEmbed(song) });
                } else {
                    message.channel.send(`\`${song.title}\` queued in position \`${queue.indexOf(song)+1}\` for channel: ${song.channel.toString()}`);
                }
            }
            return;
            case "loop":
                if (message.content.split(' ').length < 2) {
                    return message.channel.send(`Queue looping is ${(repeat ? "on" : "off")}`);
                }
                if (!(authorPerms.includes("admin") | authorPerms.includes("music.*") | authorPerms.includes("music.play"))) {
                    return message.channel.send("You do not have permission to run this command. Requires `music.play`");
                }
                if (message.content.split(' ')[1] == "on") {
                    repeat = true;
                } else if (message.content.split(' ')[1] == "off") {
                    repeat = false;
                }
                return message.channel.send(`Queue looping is ${(repeat ? "on" : "off")}`);
        case "volume":
            const authorPerms = getPerms(message.author, message.member);
            if (!(authorPerms.includes("admin") | authorPerms.includes("music.*") | authorPerms.includes("music.volume"))) {
                message.channel.send(`You do not have permission to run this command. Requires \`music.volume\``);
            }
            if (!client.voice.connections.first()) {
                message.channel.send("Not currently playing");
            }
            if (!message.content.split(' ')[1]) {
                emitter.emit("volumePrint", message);
                return;
            }
            if (!isNaN(parseInt(message.content.split(' ')[1]))) {
                emitter.emit("volumeSet", parseInt(message.content.split(' ')[1]));
                return;
            }
            message.channel.send("Please set a correct volume percentage");
            return;
        case "autodelete":
            if (!getPerms(message.author, message.member).includes('admin')) {
                return message.channel.send("You do not have permission to use this command. Requires `admin`");
            }
            if (!message.content.split(' ')[1]) {
                return message.channel.send(`Please enter all arguments correctly. \`${config.prefix}autodelete <time/off>\``);
            }
            const time = ms(message.content.split(' ')[1])/60000;
            if (time < 1) {
                if (message.content.split(' ')[1] === "off") {
                    db.set(`channels.${message.channel.id}.time`, 0).write();
                    return message.channel.send(`Messages in this channel will not be automatically deleted.`);
                } else {
                    return message.channel.send("Please enter a valid amount of time. Minimum 1 minute");
                }
            }
            db.set(`channels.${message.channel.id}.time`, time).write();
            return message.channel.send(`Messages in this channel will be deleted after ${pretty_ms(time*60000, { compact: true })}`);
        case "notifications":
            if (message.content.split(' ')[1] === "on") {
                if (message.member.roles.cache.has(config.roles.notifications)) {
                    return message.channel.send("You have already enabled notifications");
                }
            message.member.roles.add(config.roles.notifications);
            return message.channel.send(`${message.author.toString()} Notifications enabled`);
            }
            if (message.content.split(' ')[1] === "off") {
                if (message.member.roles.cache.has(config.roles.notifications)) {
                    message.member.roles.remove(config.roles.notifications);
                    return message.channel.send(`${message.author.toString()} Notifications disabled`);
                }
                return message.channel.send("You do not have notifications enabled");
            }
            return message.channel.send(`Please enter all arguments correctly: \`${config.prefix}notifications <on/off>\``);
        case "announce":
            return announce(message);
        case "credits":
            return message.channel.send("Shadow is built by Beckett O'Brien");
    }
}

function help(message) {
    const command = message.content.split(' ')[1];
    if (!command) {
        return message.channel.send({ embed: {
            "description": `Use \`${config.prefix}help <command>\` to get more detailed information about each command.`,
            "color": config.embedColor,
            "fields": [
            {
                "name": "Music",
                "value": `\`${config.prefix}play\`, \`${config.prefix}pause\`,\`${config.prefix}resume\`,\`${config.prefix}stop\`, \`${config.prefix}skip\`,\`${config.prefix}volume\`,\`${config.prefix}queue\`,\`${config.prefix}loop\``
            },
            {
                "name": "User",
                "value": `\`${config.prefix}notifications\``
            },
            {
                "name": "Admin",
                "value": `\`${config.prefix}mute\`,\`${config.prefix}unmute\`,\`${config.prefix}announce\``
            },
            {
                "name": "Info",
                "value": `\`${config.prefix}help\`,\`${config.prefix}stats\`,\`${config.prefix}credits\``
            },
            {
                "name": "Permissions",
                "value": `\`${config.prefix}perms\``
            }
            ],
            "author": {
            "name": "Shadow",
            "icon_url": client.user.displayAvatarURL()
            }
        }});
    }
    var out = "That command does not exist";
    switch (command) {
        case "help":
            out = `Shows the list of possible commands or more information for a specific command.\nUsage: \`${config.prefix}help [command]\``;
            break;
        case "stats":
            out = `Shows server statistics.\nUsage: \`${config.prefix}stats\``;
            break;
        case "play":
            out = `Queues a song or a spotify playlist to be played in the current voice channel.\nUsage: \`${config.prefix}play <song>\` or \`${config.prefix}play <playlist url> [shuffle:yes/no] [limit]\`\nPermissions: \`music.play\``;
            break;
        case "stop":
            out = `Stops the currently playing music and resets the queue.\nUsage: \`${config.prefix}stop\`\nPermissions: \`music.play\``;
            break;
        case "pause":
            out = `Pauses the currently playing music to be resumed later.\nUsage: \`${config.prefix}pause\`\nPermissions: \`music.play\``;
            break;
        case "resume":
            out = `Resumes the currently playing music if paused.\nUsage: \`${config.prefix}resume\`\nPermissions: \`music.play\``;
            break;
        case "skip":
            out = `Skips the currently playing song and continues to the next queued song, stopping if none.\nUsage: \`${config.prefix}skip\`\nPermissions: \`music.play\``;
            break;
        case "perms":
            out = `Runs a permissions command. Run without a command to see a list of valid commands.\nUsage: \`${config.prefix}perms [command]\``;
            break;
        case "mute":
            out = `Mutes the mentioned user for the specified amount of time.\nUsage: \`${config.prefix}mute <user> <time>\`\nPermissions: \`mute.mute\``;
            break;
        case "unmute":
            out = `Unmutes the given user manually.\nUsage: \`${config.prefix}unmute <user>\`\nPermissions: \`mute.unmute\``;
            break;
        case "queue":
            out = `Shows the current music queue.\nUsage: \`${config.prefix}queue\``;
            break;
        case "loop":
            out = `Enables/Disables looping of the music queue\nUsage: \`${config.prefix}loop [on/off]\`\nPermissions: \`music.play\``;
            break;
        case "volume":
            out = `Returns the current global volume of the music or sets the volume to the specified percentage.\nUsage: \`${config.prefix}volume [amount]\``;
            break;
        case "notifications":
            out = `Enables/Disables being pinged by the Notification Squad role in the LFG channels.\nUsage: \`${config.prefix}notifications <on/off>\``;
            break;
        case "announce":
            out = `Sends the message to the specified channel.\nUsage: \`${config.prefix}announce <channel> <message>\``;
            break;
        case "credits":
            out = `Shows information about Shadow's credits`;
            break;
    }
    return message.channel.send(out);
}

function announce(message) {
    const perms = getPerms(message.author, message.member);
    if (!(perms.includes("admin") | perms.includes("announce.*"))) {
        return message.channel.send("You do not have permissions to use this command. Requires: \`announce.*\`");
    }
    const channel = message.mentions.channels.first();
    if (!channel) {
        return message.channel.send(`Please enter all arguments correctly: \`${config.prefix}announce <channel> <message>\``);
    }
    const send = message.content.replace(`${config.prefix}announce ${channel.toString()} `, '')
    if (!send) {
        return message.channel.send(`Please enter all arguments correctly: \`${config.prefix}announce <channel> <message>\``);
    }
    channel.send(send);
    return message.channel.send(`Made announcement in ${channel.toString()}`);
}

function getPerms(user, member) {
    var perms = db.get(`users.${user.id}`).value().perms;
    for (const roleId of Array.from(member.roles.cache.keys())) {
        if (!db.get(`roles.${roleId}`).value()) {
            continue;
        }
        perms = perms.concat(db.get(`roles.${roleId}`).value().perms);
    }
    if (member.permissions.has("ADMINISTRATOR")) {
        perms = perms.concat(config.perms);
    }
    return perms;
}

function permsCommand(message) {
    const authorPerms = getPerms(message.author, message.member);
    const target = message.mentions.users.first() ? message.mentions.users.first() : (message.mentions.roles.first() ? message.mentions.roles.first() : message.author);
    const type = target instanceof Discord.User ? 'users' : 'roles';
    var perms = db.get(`${type}.${target.id}`).value().perms;
    const command = message.content.substring(1).split(' ')[1];
    const perm = message.content.substring(1).split(' ')[2]
    switch (command) {
        case "list":
            if (!(authorPerms.includes("admin") | authorPerms.includes("perms.*") | authorPerms.includes("perms.list"))) {
                return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`perms.list\``)
            }
            if (message.content.substring(1).split(' ')[2]) {
                perms = db.get(`${type}.${target.id}`).value().perms;
                return message.channel.send(`${target.toString()} has the following permissions: \`${perms.join(', ')}\``);
            }
            return message.channel.send(`${target.toString()} You have the following permissions: \`${perms.join(', ')}\``);
        case "add":
            if (!(authorPerms.includes("admin") | authorPerms.includes("perms.*") | authorPerms.includes("perms.edit"))) {
                return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`perms.edit\``)
            }
            if (!(message.mentions.members.first())) {
                if (!(authorPerms.includes("admin") | (message.guild.owner.id === message.member.id))) {
                    return message.channel.send(`${message.author.toString()}, you do not have permission to edit perms for yourself/your role.`)
                }
            } else {
                if (Discord.Role.comparePositions(message.mentions.members.first().roles.hoist, message.member.roles.hoist) >= 0) {
                    return message.channel.send(`${message.author.toString()}, you do not have permission to edit perms for this user/role`);
                }
            }
            if (perm) {
                if (!config.perms.includes(perm)) {
                    return message.channel.send(`\`${perm}\` is not a valid permission node`);
                }
                if (perms.includes(perm)) {
                    return message.channel.send(`${message.author.toString()} already has \`${perm}\``);
                }
                if (perm === "admin") {
                    if (!message.member.permissions.has("ADMINISTRATOR")) {
                        return message.channel.send(`${message.author.toString()} Only server administrators may give the admin node`);
                    }
                }
                perms.push(perm);
                db.get(`${type}.${message.author.id}`).push(perms).write();
                return message.channel.send(`Added \`${perm}\` to ${target.toString()}`);
            }
            return message.channel.send(`${message.author.toString()}, please enter all arguments: \`${config.prefix}perms add <node> [user]\``);
        case "remove":
            if (!(authorPerms.includes("admin") | authorPerms.includes("perms.*") | authorPerms.includes("perms.edit"))) {
                return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`perms.edit\``)
            }
            if (!(message.mentions.members.first())) {
                if (!(authorPerms.includes("admin") | (message.guild.owner.id === message.member.id))) {
                    return message.channel.send(`${message.author.toString()}, you do not have permission to edit perms for yourself/your role.`)
                }
            } else {
                if (Discord.Role.comparePositions(message.mentions.members.first().roles.hoist, message.member.roles.hoist) >= 0) {
                    return message.channel.send(`${message.author.toString()}, you do not have permission to edit perms for this user/role`);
                }
            }
            if (perm) {
                if (~perms.indexOf(perm)) {
                    if (perm === "admin") {
                        if (!message.member.permissions.has("ADMINISTRATOR")) {
                            return message.channel.send(`${message.author.toString()} Only server administrators may remove the admin node`);
                        }
                    }
                    perms.splice(perms.indexOf(perm),1);
                    db.get(`${type}.${target.id}`).push(perms).write();
                    return message.channel.send(`Removed \`${perm}\` from ${target.toString()}`);
                }
                return message.channel.send(`${message.author.toString()} does not have \`${perm}\``);
            }
            return message.channel.send(`${message.author.toString()}, please enter all arguments: \`${config.prefix}perms remove <node> [user]\``);
        case "nodes":
            if (!(authorPerms.includes("admin") | authorPerms.includes("perms.*") | authorPerms.includes("perms.edit"))) {
                return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`perms.edit\``)
            }
            return message.channel.send(`Permission nodes:\n\`\`\`\n${config.perms.map(node => {return node + '\n';})}\`\`\``.split(',').join(''));
        default:
            return message.channel.send(`Please specify a valid perms command: \`list\`,\`add\`,\`remove\`,\`nodes\``);
    }
}

function mute(message) {
    const perms = getPerms(message.author, message.member);
    if (!(perms.includes("admin") | perms.includes("mute.*"))) {
        return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`mute.*\``)
    }
    const user = message.mentions.users.first();
    const member = message.mentions.members.first();
    if (user) {
        const timeString = message.content.split(`${config.prefix}mute ${user.toString()} `).join('')
        const time = ms(timeString);
        if (time !== 0) {
            if (Discord.Role.comparePositions(member.roles.hoist, message.member.roles.hoist) >= 0) {
                return message.channel.send(`${message.author.toString()}, you do not have permission to mute this user`);
            }
            message.guild.roles.fetch(config.roles.muted).then(role => {
                message.guild.members.fetch(user).then(member => {
                    if (muteTimers[user.id]) {
                        return message.channel.send(`${message.author.toString()}, user has already been muted`);
                    }
                    member.roles.add(role);
                    muteTimers[user.id] = setTimeout(() => {
                        member.roles.remove(role);
                        message.channel.send(`${user.toString()} has been unmuted`);
                    }, time);
                    return message.channel.send(`${user.toString()} has been muted for: ${timeString}`);
                });
            });
            return;
        } else {
            return message.channel.send(`${message.author.toString()}, please enter a propper amount of time`);
        }
        return message.channel.send(`${message.author.toString()} Sorry, something went wrong`);
    }

    return message.channel.send(`${message.author.toString()} Please enter all arguments correctly: \`${config.prefix}mute <user> <time>\``);
}

function unmute(message) {
    const perms = getPerms(message.author, message.member);
    if (!(perms.includes("admin") | perms.includes("mute.*"))) {
        return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`mute.*\``)
    }
    const user = message.mentions.users.first();
    if (!user) {
        return message.channel.send(`Please specify a user`);
    }
    message.guild.roles.fetch(config.roles.muted).then(role => {
        message.guild.members.fetch(user).then(member => {
            member.roles.remove(role);
            clearTimeout(muteTimers[user.id]);
            message.channel.send(`${user.toString()} has been unmuted`);
        });
    });
}

function queueSong(message) {
    const perms = getPerms(message.author, message.member);
    if (!(perms.includes("admin") | perms.includes("music.*") | perms.includes("music.play"))) {
        return message.channel.send(`${message.author.toString()} You do not have permissions to use this command. Requires \`music.play\``)
    }
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.channel.send(`${message.author.toString()} Please join a voice channel first!`);
    }

    if (message.guild.voiceState) {
        console.log(message.guild.voiceState);
        if (voiceChannel !== message.guild.voiceState.channel) {
            console.log("Already in different channel");
        }
    }

    if (message.content.split(' ')[1].includes("https://open.spotify.com/playlist/")) {
        console.log(message.content.split(' ')[1]);
        return spotifyPlaylistQueue(message.content.split(' ')[1], message);
    }
    return youtubeQueue(message.content.replace('+play ', ''), message);
}

function spotifyPlaylistQueue(playlistUrl, message) {
    const playlistId = playlistUrl.replace('https://open.spotify.com/playlist/','');
    const options = {
        url: "https://accounts.spotify.com/api/token",
        form: {
            "grant_type": "client_credentials"
        },
        headers: {
            "Authorization": `Basic ${config.spotify.clientCredentialsAuth}`
        }
    }
    request.post(options, async (err, res, body) => {
        if (err) {
            console.log(err);
        }
        const access_token = JSON.parse(body).access_token;
        var tracks = [];
        for (var offset = 0; offset <= 9900; offset += 100) {
            const newTracks = await spotifyPlaylistGetTracksWithOffset(playlistId, offset, access_token);
            tracks = tracks.concat(newTracks);
            if (newTracks.length < 100) {
                break;
            }
        }
        var limit = 5;
        if (message.content.split(' ')[3] && !isNaN(parseInt(message.content.split(' ')[3]))) {
            limit = parseInt(message.content.split(' ')[3]);
        }
        for (track of (message.content.split(' ')[2] === 'yes' ? shuffle(tracks).slice(0,limit) : tracks.slice(0,limit))) {
            console.log(track.track);
            youtubeQueue(track.track.name, message);
        }
    });
}

function spotifyPlaylistGetTracksWithOffset(id, offset, token) {
    return new Promise((resolve,reject) => {
        request.get(`https://api.spotify.com/v1/playlists/${id}/tracks?fields=items(track(name))&offset=${offset}`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        }, (e, r, b) => {
            if (e) {
                console.log(e);
                reject(e);
            }
            resolve(JSON.parse(b).tracks.items);
        });
    })
}

function youtubeQueue(title, message) {
    const search = title.split(' ').join('+');
    var videoId;
    http.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${search}&type=video&key=${config.youtubeApiToken}`, res => {
        var str = '';
        res.on("data", body => {
            str += body;
        });
        res.on("end", () => {
            try {
                const data = JSON.parse(str);
                const queueData = {
                    url: `https://www.youtube.com/watch?v=${data.items[0].id.videoId}`,
                    title: data.items[0].snippet.title,
                    thubmnail: data.items[0].snippet.thumbnails.high.url,
                    channelTitle: data.items[0].snippet.channelTitle,
                    channel: message.member.voice.channel,
                    requestChannel: message.channel,
                    requester: message.author.toString()
                }
                queue.push(queueData);
                if (queue.length > 1) {
                    message.channel.send(`Queued \`${queueData.title}\` in position \`${queue.length}\` for channel: ${queueData.channel.toString()}`);
                } else {
                    startQueueForChannel();
                }
            } catch {
                return message.channel.send("Could not find song");
            }
        });
    });
}

function startQueueForChannel() {
    const songData = queue[0];

    songData.requestChannel.send({ embed: nowPlayingEmbed(songData) });

    songData.channel.join().then(async connection => {
        const stream = await ytdl(songData.url, { filter: "audioonly", quality: "highestaudio" });
        const dispatcher = connection.play(stream, {bitrate:config.bitrate*1000,type:'opus',highWaterMark:config.streamBuffer});

        dispatcher.on("finish", () => {
            qqueue.shift();
            if (repeat) {
                queue.push(songData);
            }
            if (queue.length === 0) {
                songData.channel.leave();
            } else if (songData.channel == queue[0].channel) {
                nextForChannel(connection);
            } else {
                startQueueForChannel();
            }
        });

        emitter.on("stop", () => {
            queue = [];
            songData.channel.leave();
        });
        emitter.on("pause", () => {
            dispatcher.pause();
        });
        emitter.on("resume", () => {
            dispatcher.resume();
        });
        emitter.on("skip", () => {
            dispatcher.end();
        });
        emitter.on("volumePrint", message => {
            message.channel.send(`Current Volume: ${dispatcher.volume*50}%`);
        })
        emitter.on("volumeSet", volume => {
            dispatcher.setVolume(volume/50);
        })
    })
}

async function nextForChannel(connection) {
    const songData = queue[0];
    const stream = await ytdl(songData.url, { filter: "audioonly", quality: "highestaudio" });
    const dispatcher = connection.play(stream, {bitrate:config.bitrate*1000,type:'opus',highWaterMark:config.streamBuffer});

    songData.requestChannel.send({ embed: nowPlayingEmbed(songData) });

    dispatcher.on("finish", () => {
        queue.shift();
        if (repeat) {
            queue.push(songData);
        }
        if (queue.length === 0) {
            songData.channel.leave();
        } else if (songData.channel == queue[0].channel) {
            nextForChannel(connection);
        } else {
            startQueueForChannel();
        }
    });

    emitter.on("stop", () => {
        queue = [];
        songData.channel.leave();
    });
    emitter.on("pause", () => {
        dispatcher.pause();
    });
    emitter.on("resume", () => {
        dispatcher.resume();
    });
    emitter.on("skip", () => {
        dispatcher.end();
    });
}

function nowPlayingEmbed(songData) {
    return {
        "title": `${songData.title}`,
        "url": `${songData.url}`,
        "color": config.embedColor,
        "fields": [
        //   {
        //     "name": "Duration:",
        //     "value": "time",
        //     "inline": true
        //   },
          {
            "name": "Requested By:",
            "value": `${songData.requester}`,
            "inline": true
          },
          {
            "name": "Voice Channel:",
            "value": `${songData.channel.toString()}`,
            "inline": true
          }
        ],
        "author": {
          "name": `${songData.channelTitle}`
        },
        "thumbnail": {
          "url": `${songData.thubmnail}`
        }
    }
}

function shuffle(a) {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

if (config.debug == "true") {
    console.log(config.debug);
    client.on('debug', console.log);
}

client.login(config.token);
