//(function($) {

  // globally accessible variables
  var mopidy, socket, playback, tracklist, search, debug=true, booting=true,
    // handlebars templates
    tracks_template, search_results_template, track_info, filemanager_template,
    // elements
    $body, $controls, $search_form, $containers, $track_info, $status,
    $progress, $volume, $filemanager, $sync_tag_cache;


  // object literals (singletons)
  socket = {
    online: function() {
      $status.removeClass('icon-spinner')
        .addClass('icon-ok')
        .attr('title', "You are connected")
        .tooltip('destroy')
        .tooltip({ placement: 'left' });
      tracklist.sync();
      mopidy.playback.getState().then(function(state) {
        if (state == 'paused' || state == 'stopped') {
          $controls.playpause.paused();
        } else {
          $controls.playpause.playing();
        }
        playback.getVolume();
      }, console.error);
    },
    offline: function() {
      $status.removeClass('icon-music')
        .addClass('icon-spinner')
        .attr('title', "You are not connected to the MPD")
        .tooltip('destroy')
        .tooltip({ placement: 'left' });
    }
  };

  utilities = {
    getFirst: function(arr) {
      return arr[0];
    },
    message: function(str) {
      alert(str);
    },
    addByURI: function() {
      var uri = prompt("Enter a spotify URI or a path to the file you'd like to play");
      if (uri) tracklist.addTracksByURI(uri);
    }
  };

  search = {
    submit: function(e) {
      e.preventDefault();
      var vals = $search_form.serializeArray(), context, query;
      for (var i in vals) {
        if (vals[i].name == 'query') {
          query = vals[i].value;
        } else if (vals[i].name == 'context') {
          context = vals[i].value || 'any';
        }
      }
      if (query) {
        search.query(context, query);
      } else {
        utilities.message("Please enter a query", "error");
      }
    },
    query: function(context, query) {
      var params={};
      context = context || 'any';
      params[context] = [query];
      // override search form values
      $search_form.find('input[type="search"]').val(query);
      $search_form.find('select').val(context);
      // and search
      mopidy.library.search(params).then(search.handleResults, console.error);
    },
    handleResults: function(results) {
      if (debug) console.log("\n\nhandleResults", results, "\n\n");
      var i, $el;
      for (i in [0, 1]) {
        results[i].count = results[i].tracks ? results[i].tracks.length : i;
        if (results[i].count == 200) results[i].count = '200+';
      }
      $search_results.html(search_results_template({ results: results })).slideDown();
      $search_results.find('h3').click(function() {
        $el = $(this);
        $el.siblings().removeClass('on').end().addClass('on');
        $('.search-results .' + $el.data('rel')).siblings().removeClass('on').end().addClass('on');
      });
      $search_results.find('.icon-remove').unbind('click').click(search.clearResults);
      $search_results.find('.search-results a').click(tracklist.addTracksByURI);
      // SPECIAL CASE for artist links in results
      // we don't want to add all tracks by an artist, so just run a search
      // based on the artist's name
      $search_results.find('.search-results .artists a').unbind('click').click(function(e) {
        e.preventDefault();
        $el = $(this);
        search.query('artist', $el.text());
      });
      // tooltips
      $search_results.find('[title]').tooltip({ placement: 'right' });
    },
    clearResults: function(e) {
      e.preventDefault();
      $search_results.slideUp(function() {
        $search_results.empty().hide();
      });
      $search_form.find('input[type="search"], select').val('');
    }
  };

  filemanager = {
    open: function(e) {
      e.preventDefault();
      $filemanager.addClass('icon-folder-open-alt');
      // NOTE - the src does not include the port, since the filemanager runs
      // on nginx (port 80)
      $body.prepend(filemanager_template({
        width: 800,
        height: 600,
        src: window.location.origin.split(':' + window.location.port).join('') + '/filemanager'
      }));
      $('#overlay, #overlay .icon-remove').click(filemanager.close);
    },
    close: function(e) {
      e.preventDefault();
      $filemanager.removeClass('icon-folder-open-alt');
      $('#overlay').remove();
    },
    syncTagCache: function(e) {
      e.preventDefault();
      if ($sync_tag_cache.hasClass('icon-spinner')) return;
      $sync_tag_cache.addClass('icon-spinner');
      mopidy.library.refresh().then(filemanager.handleRefreshed, console.error);
    },
    handleRefreshed: function() {
      $sync_tag_cache.removeClass('icon-spinner');
    }
  }

  playback = {
    volume: null,
    current: null,
    prev: function(e) {
      e.preventDefault();
      if ($controls.prev.hasClass('disabled')) return;
      mopidy.playback.previous();
    },
    playpause: function(e) {
      e.preventDefault();
      // TODO: check the actual playback state, not the css class
      if ($controls.playpause.hasClass('icon-pause')) {
        mopidy.playback.pause();
      } else {
        mopidy.playback.play();
      }
    },
    next: function(e) {
      e.preventDefault();
      if ($controls.next.hasClass('disabled')) return;
      mopidy.playback.next();
    },
    syncCurrentTrack: function() {
      if (debug) console.log("\n\nsyncCurrentTrack\n\n");
      mopidy.playback.getCurrentTlTrack()
        .then(playback.printTrackInfo, console.error);
    },
    printTrackInfo: function(data) {
      if (debug) console.log("\n\nprintTrackInfo\n\n", data);
      playback.current = data.tl_track || data; // depends on what's calling this
      $track_info.html(track_info_template(playback.current));
      tracklist.gotoCurrentTrack(playback.current.tlid);
      if (booting) {
        playback.pingTrackTime();
        booting = false;
      }
    },
    clearTrackInfo: function() {
      if (debug) console.log("\n\nclearTrackInfo\n\n");
      $track_info.html('&nbsp;');
    },
    getVolume: function() {
      if (debug) console.log("\n\ngetVolume\n\n");
      mopidy.playback.getVolume().then(playback.printVolume, console.error);
    },
    setVolume: function(volume) {
      if (debug) console.log("\n\nsetVolume\n\n");
      mopidy.playback.setVolume(volume);
    },
    changeVolume: function(e) {
      if (debug) console.log("\n\nchangeVolume\n\n");
      // click handler for our volume bar
      e.preventDefault();
      var vol = ((e.pageX - $volume.wrap.offset().left) / $volume.wrap.width()) * 100;
      playback.setVolume(vol);
    },
    toggleVolume: function(e) {
      if (debug) console.log("\n\ntoggleVolume\n\n");
      e.preventDefault();
      if ($volume.btn.hasClass('icon-volume-up')) {
        playback.setVolume(playback.volume);
        $volume.btn.removeClass('icon-volume-up');
      } else {
        playback.setVolume(0);
        $volume.btn.addClass('icon-volume-up');
      }
    },
    handleVolumeChanged: function(data) {
      playback.volume = data.volume;
      $volume.bar.width(data.volume + '%');
    },
    printVolume: function(volume) {
      if (debug) console.log("\n\nprintVolume\n\n", volume);
      playback.volume = volume;
      $volume.bar.width(volume + '%');
      if (volume > 0) {
        $volume.btn.removeClass('icon-volume-up');
      } else {
        $volume.btn.addClass('icon-volume-up');
      }
    },
    pingTrackTime: function() {
      mopidy.playback.getTimePosition().then(playback.printTrackTime, console.error);
    },
    printTrackTime: function(time) {
      $progress.bar.width((time / playback.current.track.length * 100) + '%');
      // and set it moving
      // NOTE: used to ping the server, every 2 seconds to set the time, but
      // this seems like it might be a better solution
      $progress.bar.stop().animate({
        width: '100%',
      }, (playback.current.track.length - time), 'linear');
    },
    handleSeeked: function(data) {
      // called when mopidy fires a 'seeked' event
      //playback.stopPinging();
      $progress.bar.width((data.time_position / playback.current.track.length * 100) + '%');
      playback.pingTrackTime();
    },
    handleSeek: function(e) {
      // click handler for our progress bar
      e.preventDefault();
      var $el = $(this);
      var to = ((e.pageX - $el.offset().left) / $el.width()) * playback.current.track.length;
      mopidy.playback.seek(parseInt(to, 10));
    },
    handlePlaybackStarted: function(data) {
      if (debug) console.log("\n\nhandlePlaybackStarted\n\n", data);
      playback.printTrackInfo(data);
      $progress.bar.width(0);
      $controls.playpause.playing();
    },
    handlePlaybackEnded: function(data) {
      if (debug) console.log("\n\nhandlePlaybackEnded\n\n", data);
      playback.clearTrackInfo();
      $progress.bar.width(0);
      $controls.playpause.paused();
    },
    handlePlaybackResumed: function(data) {
      if (debug) console.log("\n\nhandlePlaybackResumed\n\n", data);
      $controls.playpause.playing();
    },
    handlePlaybackPaused: function(data) {
      if (debug) console.log("\n\nhandlePlaybackPaused\n\n", data);
      $controls.playpause.paused();
    },
    handleVolumeChange: function(data) {
      if (debug) console.log("\n\nhandleVolumeChange\n\n", data);
    }
  };

  tracklist = {
    sortable_options: {
      axis: 'y',
      handle: '.handle'
    },
    sync: function() {
      mopidy.tracklist.getTlTracks()
        .then(tracklist.print, console.error);
    },
    print: function(tracks) {
      if (debug) console.log("\n\nprint\n\n");
      if (tracks.length == 0) {
        $controls.playpause.paused();
        $controls.playpause.disable();
        $containers.tracklist.empty();
        return;
      }
      $controls.playpause.enable();
      $containers.tracklist.html(tracks_template({ tracks: tracks }));
      // add an 'on' class to the current track
      playback.syncCurrentTrack();
      // click events for tracks
      $containers.tracklist.find('a').click(tracklist.playTrack);
      $containers.tracklist.find('.icon-remove').click(tracklist.removeTrack);
      // add selectable / sortable functionality
      $containers.tracklist.selectable({
          cancel: 'i,a', // allows us to click these elements
          start: tracklist.resetSelectable,
          stop: function(event, ui) {
            var $wrapped, tlids;
            $containers.tracklist.find('.ui-selected').wrapAll('<li class="wrapped"><ul></ul></li>');
            $wrapped = $containers.tracklist.find('.wrapped');
            $wrapped.prepend('<i class="icon-resize-vertical handle"></i><i class="icon-remove remove-all"></i>');
            tlids = [];
            $wrapped.find('a').each(function() {
              tlids.push($(this).data('tlid'));
            });
            $wrapped.find('.remove-all').data('tlids', tlids).click(tracklist.removeTracks)
            $containers.tracklist.sortable('destroy').sortable(tracklist.sortable_options);
          }
        }).sortable(tracklist.sortable_options);
      // deselect when we click outside of the tracklist
      $('.main-container').unbind('click').click(tracklist.resetSelectable);
      $containers.tracklist.click(function(e) {
        e.stopPropagation();
      });
    },
    gotoCurrentTrack: function(tlid) {
      var $cur = $containers.tracklist.find('#tlid-' + tlid);
      if ($cur.siblings().length) $cur.siblings().removeClass('on');
      var scrolltop = $cur.addClass('on').offset().top;
      // 136 is the height of the header - probably better to get this value
      // dynamically
      $body.animate({
        scrollTop: (scrolltop - 136)
      }, 300);
    },
    resetSelectable: function() {
      // this seems a lil dirty, but don't see a better way to do it in the
      // jQuery UI docs
      $containers.tracklist.find('.wrapped > .handle, .wrapped > .remove-all').remove();
      $containers.tracklist.find('.wrapped li').unwrap().unwrap();
      $containers.tracklist.find('.ui-selected').removeClass('ui-selected');
    },
    // click events
    playTrack: function(e) {
      if (debug) console.log("\n\nplayTrack\n\n");
      e.preventDefault();
      mopidy.tracklist.filter({ 'tlid': $(e.currentTarget).data('tlid') })
        .then(utilities.getFirst, console.error)
        .then(mopidy.playback.play, console.error);
    },
    removeTrack: function(e) {
      // click event - remove a single track
      e.preventDefault();
      mopidy.tracklist.remove({ 'tlid': $(e.currentTarget).data('tlid') });
    },
    removeTracks: function(e) {
      // click event - remove multiple tracks
      //
      // TODO: make sure there's not a better way to do this
      // mopidy.tracklist.remove() takes a filter as the first argument -
      // passing an array doesn't seem to work...
      e.preventDefault();
      var tlids = $(e.currentTarget).data('tlids');
      for (var i in tlids) {
        mopidy.tracklist.remove({ 'tlid': tlids[i] });
      };
    },
    clear: function(e) {
      if (debug) console.log("\n\nclear\n\n");
      e.preventDefault();
      mopidy.playback.stop();
      mopidy.tracklist.clear();
    },
    addTracksByURI: function(e) {
      var uri;
      if (typeof e === 'string') {
        uri = e;
      } else {
        e.preventDefault();
        uri = $(e.currentTarget).data('uri');
      }
      mopidy.library.lookup(uri)
        .then(mopidy.tracklist.add, console.error);
      if (uri.indexOf('spotify:album') == 0) {
        search.clearResults(e);
      }
    }
  };


  // constructors (may have many instances)
  function control(params) {
    this.selector = params.selector;
    this.$el = $(this.selector);
    if (params.click && typeof params.click == 'function') {
      this.$el.click(params.click);
    }
    // add some custom enabled / disabled functionality
    this.$el.disable = function() {
      this.addClass('disabled');
    }
    this.$el.enable = function() {
      this.removeClass('disabled');
    }
    return this.$el;
  }

  function container(params) {
    this.selector = params.selector;
    this.$el = $(this.selector);
    return this.$el;
  }

  function init() {
    // store references to DOM elements
    $body = $('body');
    $controls = {
      prev: new control({
        selector: '#prev',
        click: playback.prev
      }),
      next: new control({
        selector: '#next',
        click: playback.next
      }),
      playpause: new control({
        selector: '#playpause',
        click: playback.playpause,
      }),
      clear: new control({
        selector: '#clear-tracklist',
        click: tracklist.clear
      })
    };
    $containers = {
      tracklist: new container({
        selector: '#tracklist'
      })
    };
    $progress = {
      bar: new container({
        selector: '#playback-info .bar'
      }),
      info: new control({
        selector: '#playback-info',
        click: playback.handleSeek
      })
    };
    $volume = {
      wrap: new control({
        selector: '#volume',
        click: playback.changeVolume
      }),
      bar: new control({
        selector: '#volume .bar',
      }),
      btn: new control({
        selector: '.volume-icon-off',
        click: playback.toggleVolume
      })
    };
    $track_info = $('#playback-info .info');
    $status = $('#status');

    // special functionality for our playpause button
    $controls.playpause.paused = function() {
      if (debug) console.log("\n\npaused\n\n");
      this.removeClass('icon-pause').addClass('icon-play');
      $controls.prev.disable();
      $controls.next.disable();
      $progress.bar.stop();
    }
    $controls.playpause.playing = function() {
      if (debug) console.log("\n\nplaying\n\n");
      this.removeClass('icon-play').addClass('icon-pause');
      $controls.prev.enable();
      $controls.next.enable();
      playback.pingTrackTime();
    }

    // search form
    $search_form = $('#search');
    $search_form.submit(search.submit);
    $search_results = $('#search-results');

    // filesystem icon
    $filemanager = $('#filemanager');
    $filemanager.click(filemanager.open);
    $sync_tag_cache = $('#sync-tag-cache');
    $sync_tag_cache.click(filemanager.syncTagCache);

    // set up our handlebars templates
    tracks_template = Handlebars.compile($('#tracks-hbs').html());
    search_results_template = Handlebars.compile($('#search-results-hbs').html());
    track_info_template = Handlebars.compile($('#track-info-hbs').html());
    filemanager_template = Handlebars.compile($('#filemanager-hbs').html());

    // initialize mopidy
    if (typeof Mopidy !== 'undefined') {
      mopidy = new Mopidy();
      if (debug) mopidy.on(console.log.bind(console)); // log all events
      mopidy.on("state:online", socket.online);
      mopidy.on("state:offline", socket.offline);

      mopidy.on("event:tracklistChanged", tracklist.sync);
      mopidy.on("event:trackPlaybackStarted", playback.handlePlaybackStarted);
      mopidy.on("event:trackPlaybackEnded", playback.handlePlaybackEnded);
      mopidy.on("event:trackPlaybackPaused", playback.handlePlaybackPaused);
      mopidy.on("event:trackPlaybackResumed", playback.handlePlaybackResumed);
      mopidy.on("event:seeked", playback.handleSeeked);
      mopidy.on("event:volumeChanged", playback.handleVolumeChanged);
    }

    $('[title]').tooltip();
    $('.filemanager-controls a').tooltip('destroy').tooltip({
      placement: 'right'
    });
  }
  $(init); // start it up on document ready

//})(jQuery);
