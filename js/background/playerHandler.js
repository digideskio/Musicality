/**
 * Copyright 2014 Kyle Kamperschroer (http://kylek.me)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
**/

/**
 * A class to handle all interaction with the player
 */
function PlayerHandler(){
  this.logger = Logger.getInstance();
  this.lastPlayingTabId = -1;
  this.playerDetails = {};
  this.currentInfo = {}; // contains track information
  this.lastPopulateTime = 0;
  var that = this;

  // Get the scrips needed to possibly re-inject
  chrome.manifest = chrome.app.getDetails();
  this.scripts = chrome.manifest.content_scripts[0].js;

  /**
   * Send a particular request to the player using members.
   * @param  {String}   whatIsNeeded
   * @param  {Function} callback function with result of action
   */
  this.sendPlayerRequest = function(whatIsNeeded, callback, value){
    // Call the static version with our members
    this.sendPlayerStaticRequest(
      this.lastPlayingTabId,
      this.playerDetails,
      whatIsNeeded,
      callback,
      value);
  };

  /**
   * Statically send the player a request and callback results
   * @param  {int}   tabId
   * @param  {Object}   playerDetails
   * @param  {String}   whatIsNeeded
   * @param  {Function} callback
   */
  this.sendPlayerStaticRequest = function(tabId, playerDetails, whatIsNeeded, callback, value){
    this.logger.log("SendPlayerRequest for " + whatIsNeeded);

    // Check if we have the player details
    if (playerDetails !== null && playerDetails[whatIsNeeded] !== undefined){
      // Now ensure we have a content script already running
      chrome.tabs.sendMessage(tabId, { ping : "ping" }, function(response){
        if (response){
          // Tab has content script running. Send it the request.
          if(whatIsNeeded == 'seek_update') {
            chrome.tabs.sendMessage(
                tabId,
                {
                  "playerDetails" : playerDetails,
                  "scriptKey" : whatIsNeeded,
                  "value" : value
                }, function(result){
                  that.logger.log("SendPlayerRequest for " + whatIsNeeded + " callback with " + result + " and" +
                    " value: " + value);

                  if (callback){
                    callback(result);
                  }
                });
          } else {
            chrome.tabs.sendMessage(
              tabId,
              {
                "playerDetails" : playerDetails,
                "scriptKey" : whatIsNeeded
              }, function(result){
                that.logger.log("SendPlayerRequest for " + whatIsNeeded + " callback with " + result);

                if (callback){
                  callback(result);
                }
            });
          }
        } else {
          // Inject an re-request information
          that.reinjectContentScript(
            tabId,
            playerDetails,
            whatIsNeeded,
            callback,
            value);
        }
      });
    }
  };

  /**
   * Reinject content script into the provided tab
   * @param  {int}   tabId
   * @param  {Object}   playerDetails
   * @param  {String}   whatIsNeeded
   * @param  {Function} callback
   */
   this.reinjectContentScript = function(tabId, playerDetails, whatIsNeeded, callback, value){
    // Need to re-inject everything. Either new install or update.
    this.logger.log("No contentscript detected on tab " + tabId + ". Re-injecting...");

    $.each(this.scripts, function(index, curScript){
      that.logger.log("Injecting " + curScript + " into tab " + tabId);

      // Verify the tab exists before injecting
      Helper.DoesTabExist(tabId, function(exists){
        if (!exists){
          // Tab doesn't exist anymore. Need to re-find one
          that.SetTabAndDetails(-1, undefined);
        }else{
          chrome.tabs.executeScript(tabId,
          {
            file: curScript,
            allFrames: false,
            runAt: "document_start"
          }, function(){
            // Re-try the call
            that.sendPlayerStaticRequest(
              tabId,
              playerDetails,
              whatIsNeeded,
              callback,
              value);
          });
        }
      });
    });
  };

  /**
   * Helper method for determining and saving an individual detail from the player
   * @param  {String}   key to lookup AND key to store in our details as
   * @param  {function} callback (optional)
   */
  this.getValueFromPlayer = function(key, callback){
    this.sendPlayerRequest(key, function(result){
      if (result != that.currentInfo[key]){
        that.currentInfo[key] = result;
      }

      if (callback){
        callback(result);
      }
    });
  };
}

/**
 * Set the tab and details for the player handler
 */
PlayerHandler.prototype.SetTabAndDetails = function(tabId, playerDetails){
  if (this.lastPlayingTabId != tabId ||
      this.playerDetails.name != playerDetails.name){

    // Save new data and reset fields
    this.lastPlayingTabId = tabId;
    this.playerDetails = playerDetails;

    this.currentInfo = {};
  }
};

/**
 * Clear info. Only to be called when nothing is playing or paused.
 */
PlayerHandler.prototype.ClearInfo = function(){
  this.currentInfo = {};
};

/**
 * Populate everything we can find out about the player
 */
PlayerHandler.prototype.PopulateInformation = function(){
  var that = this;
  if (this.lastPlayingTabId < 0 || this.playerDetails === undefined){
    return;
  }

  // To prevent spamming the DOM too much, prevent calls to populate more
  // than once every quarter second
  var curTime = Date.now();
  if((curTime - this.lastPopulateTime) >= 250){
    this.lastPopulateTime = curTime;

    // Save off the current track and artist
    var curTrack = this.currentInfo.track;
    var curArtist = this.currentInfo.artist;

    // Grab the pieces that could have changed since last time
    // NOTE: All getValueFromPlayer commands are asynchronous
    this.getValueFromPlayer("track");
    this.getValueFromPlayer("artist");
    this.getValueFromPlayer("isPlaying");
    this.getValueFromPlayer("isPaused");
    this.getValueFromPlayer("isShuffled");
    this.getValueFromPlayer("isRepeatOff");
    this.getValueFromPlayer("isRepeatAll");
    this.getValueFromPlayer("isRepeatOne");
    this.getValueFromPlayer("isThumbedUp");
    this.getValueFromPlayer("isThumbedDown");
    this.getValueFromPlayer("artUrl");

    // Times are a little more finicky to deal with
    var hasTimeInMs = this.playerDetails.has_time_in_ms;
    if (this.playerDetails.has_current_track_time){
      this.getValueFromPlayer(
        "currentTime", function(result){
          if (!hasTimeInMs){
            that.currentInfo.currentTime = Helper.TimeToMs(result);
          }else{
            that.currentInfo.currentTime = result;
          }
        });
    }

    if (this.playerDetails.has_total_track_time){
      this.getValueFromPlayer(
        "totalTime", function(result){
          if (!hasTimeInMs){
            that.currentInfo.totalTime = Helper.TimeToMs(result);
          }else{
            that.currentInfo.totalTime = result;
          }
        });
    }else if (this.playerDetails.has_remaining_track_time){
      this.getValueFromPlayer(
        "remainingTime", function(result){
          var remainingMillis = result;
          if (!hasTimeInMs){
            remainingMillis = Helper.TimeToMs(remainingMillis);
          }

            // Update total time
            that.currentInfo.totalTime = that.currentInfo.currentTime + Math.abs(remainingMillis);
          });
    }
  }else{
    this.logger.log("Artist and track unchanged. Not requesting art or current time");
  }
};

/**
 * Get the last known tab id that was playing
 */
PlayerHandler.prototype.GetLastPlayingTabId = function(){
  return this.lastPlayingTabId;
};

/**
 * Statically determine if the given tab is playing music
 * @param {int}   tabId
 * @param {Object}   playerDetails
 * @param {Function} callback
 * @return {boolean} true if tab is playing music, false if not
 */
PlayerHandler.prototype.IsPlayingMusic = function(tabId, playerDetails, callback){
    // Only check if the tabId > 0
    if (tabId > 0){
        // Send a request to the tab provided
        this.sendPlayerStaticRequest(
          tabId,
          playerDetails,
            "isPlaying",
            callback);
    }else{
      callback(false);
    }
};

/**
 * Determine if the player is still playing music
 */
PlayerHandler.prototype.IsStillPlayingMusic = function(callback){
  // Call the static version with our members
  return this.IsPlayingMusic(
    this.lastPlayingTabId,
    this.playerDetails,
    callback);
};

/**
 * Statically determine if the tab is paused
 * @param {int}   tabId
 * @param {Object}   playerDetails
 * @param {Function} callback
 * @return {boolean} True if the tab is paused, false if not.
 */
PlayerHandler.prototype.IsPaused = function(tabId, playerDetails, callback){
    // Only check if the tabId > 0
    if (tabId > 0){
        // Send a request to the tab provided
        this.sendPlayerStaticRequest(
          tabId,
          playerDetails,
            "isPaused",
            callback);
    }else{
      callback(false);
    }
};

/**
 * Perform an action, such as clicking play or next
 * @param {string} clickWhat is what to click
 */
PlayerHandler.prototype.ClickSomething = function(clickWhat, callback, value){
  var that = this;

  this.logger.log("ClickSomething() -- " + clickWhat);
    // First, ensure that something is playing
    if (this.playerDetails !== null && this.lastPlayingTabId > 0){
        // Cool. Let's do it
        this.sendPlayerRequest(clickWhat, function(result){
          that.logger.log("ClickSomething callback -- " + result);
          // Reset last update and immediately re-populate
          that.lastPopulateTime = 0;

          // Wait just a tenth of a second before populating
          window.setTimeout(
            (function(self){
              return function(){
                self.PopulateInformation();
              };
            })(that),
            100);

          // Callback with the result
          if(callback){
            callback(result);
          }
        }, value);
    }
};

/**
 * Retrieve the current track information
 * @return {Object} Current track/playback information
 */
PlayerHandler.prototype.GetPlaybackInfo = function(){
  return this.currentInfo;
};

/**
 * Retrieve the player details
 */
PlayerHandler.prototype.GetPlayerDetails = function(){
  return this.playerDetails;
};

/**
 * Get the simple name of the player
 */
PlayerHandler.prototype.GetPlayerSimpleName = function(){
  return this.playerDetails.simple_name;
};