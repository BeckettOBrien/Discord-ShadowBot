## Welcome
This was a small discord bot I wrote for a friend's server. It has some basic server administration and music functionalities. I wish to add some more customizability and modularity and maybe clean up the code a bit in the future but I don't know when or if that will happen.

## Disclaimer
I am not actively working on this and it is not modular at all. At the moment, even if you don't need or want a feature, it can only be removed through code. If there is a modification that you would like made, feel free to make it yourself. If you have an issue please reach out and I will most likely be willing to help but I have no gaurentees about my availability in the future.

## Setup
To use this bot, make sure you have set up a bot application through the [Discord Developer Portal](https://discord.com/developers/applications). Next, fill out `config.json` with the required tokens, such as the discord bot token, a YouTube API key, Spotify API information (use the Client Credentials Flow), the AWS storage bucket of the databse, the guild and role ids, and any customized server settings. If you want to customize the server rules message, please edit `RULES.txt`.
### *At the moment each instance of the bot can only handle one server*
To run the bot, run `node index.js`

## Usage
You don't need permission to use this bot or any of the code here and you do not need to credit me directly, but it would be nice if you told me that you were using it because I think it would be really cool to know if someone was actually using this. Thank you!