(function($) {

  // 'globally' accessible variables
  var mopidy, socket, playback, tracklist, search,
    // handlebars templates
    tracks_template, search_results_template, track_info,
    // elements
    $body, $controls, $search_form, $containers, $track_info, $status,
    $progress;


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
        if (state == 'paused') {
          $controls.playpause.paused();
        } else {
          $controls.playpause.playing();
        }
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
      console.log("\n\nhandleResults", results, "\n\n");
      var i, $el;
      for (i in [0, 1]) {
        results[i].count = results[i].tracks ? results[i].tracks.length : i;
        if (results[i].count == 200) results[i].count = '200+';
      }
      $search_results.html(search_results_template({ results: results })).show();
      $search_results.find('h3').click(function() {
        $el = $(this);
        $el.siblings().removeClass('on').end().addClass('on');
        $('.search-results .' + $el.data('rel')).siblings().removeClass('on').end().addClass('on');
      });
      $search_results.find('.icon-remove').unbind('click').click(function(e) {
        e.preventDefault();
        $search_results.empty().hide();
      });
      $search_results.find('.search-results a').click(tracklist.addTracksByURI);
      // special case for artist links in results
      // we don't want to add all tracks by an artist, so just run a search
      // based on the artist's name
      $search_results.find('.search-results .artists a').unbind('click').click(function(e) {
        e.preventDefault();
        $el = $(this);
        search.query('artist', $el.text());
      });
      // tooltips
      $search_results.find('[title]').tooltip({ placement: 'right' });
    }
  };

  playback = {
    ping_delay: 2000,
    ping_int: null,
    stopPinging: function() {
      window.clearInterval(playback.ping_int);
      playback.ping_int = null;
    },
    startPinging: function() {
      if (playback.ping_int == null) {
        playback.pingTrackTime(); // start it off
        playback.ping_int = window.setInterval(playback.pingTrackTime, 2000);
      }
    },
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
      console.log("\n\nsyncCurrentTrack\n\n");
      mopidy.playback.getCurrentTlTrack()
        .then(playback.printCurrentTrackInfo, console.error);
    },
    printCurrentTrackInfo: function(data) {
      console.log("\n\nprintCurrentTrackInfo\n\n", data);
      playback.current = data.tl_track || data; // depends on what's calling this
      console.log("\n\n\n", playback.current, "\n\n\n");
      $track_info.html(track_info_template(playback.current));
      tracklist.gotoCurrentTrack(playback.current.tlid);
    },
    pingTrackTime: function() {
      mopidy.playback.getTimePosition().then(playback.printTrackTime, console.error);
    },
    printTrackTime: function(data) {
      $progress.bar.width((data / playback.current.track.length * 100) + '%');
    },
    handleSeeked: function(data) {
      // called when mopidy fires a 'seeked' event
      playback.stopPinging();
      $progress.bar.addClass('no-trans').width((data.time_position / playback.current.track.length * 100) + '%').removeClass('no-trans');
      playback.startPinging();
    },
    handleSeek: function(e) {
      // click handler for our progress bar
      e.preventDefault();
      var $el = $(this);
      var to = ((e.pageX - $el.offset().left) / $el.width()) * playback.current.track.length;
      mopidy.playback.seek(parseInt(to, 10));
    },
    handlePlaybackStarted: function(data) {
      console.log("\n\nhandlePlaybackStarted\n\n", data);
      playback.printCurrentTrackInfo(data);
      $progress.bar.width(0);
      $controls.playpause.playing();
    },
    handlePlaybackResumed: function(data) {
      console.log("\n\nhandlePlaybackResumed\n\n", data);
      $controls.playpause.playing();
    },
    handlePlaybackPaused: function(data) {
      console.log("\n\nhandlePlaybackPaused\n\n", data);
      $controls.playpause.paused();
    },
    handleVolumeChange: function(data) {
      console.log("\n\nhandleVolumeChange\n\n", data);
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
      console.log("\n\nprint\n\n");
      $containers.tracklist.html(tracks_template({ tracks: tracks }));
      // add an 'on' class to the current track
      playback.syncCurrentTrack();
      // click events for tracks
      $containers.tracklist.find('a').click(tracklist.playTrack);
      $containers.tracklist.find('.icon-remove').click(tracklist.removeTrack);
      // add selectable / sortable functionality
      $containers.tracklist.selectable({
          cancel: 'i,a',
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
    },
    gotoCurrentTrack: function(tlid) {
      var scrolltop = $containers.tracklist.find('#tlid-' + tlid)
        .siblings().removeClass('on').end()
        .addClass('on').offset().top;
      // 136 is the height of the header - might be better to get this value
      // dynamically
      $body.animate({
        scrollTop: (scrolltop - 136)
      }, 300);
    },
    resetSelectable: function() {
      $containers.tracklist.find('.wrapped > .handle, .wrapped > .remove-all').remove();
      $containers.tracklist.find('.wrapped li').unwrap().unwrap();
      // TODO: fix the selectable / sortable stuff up
      //$tracklist.find('.ui-selected').removeClass('ui-selected');
    },
    // click events
    playTrack: function(e) {
      console.log("\n\nplayTrack\n\n");
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
      console.log("\n\nclear\n\n");
      e.preventDefault();
      mopidy.playback.stop();
      mopidy.tracklist.clear();
    },
    addTracksByURI: function(e) {
      e.preventDefault();
      var uri = $(e.currentTarget).data('uri');
      mopidy.library.lookup(uri)
        .then(mopidy.tracklist.add, console.error);
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
    $track_info = $('#playback-info .info');
    $status = $('#status');

    // special functionality for our playpause button
    $controls.playpause.paused = function() {
      console.log("\n\nPAUSED\n\n");
      this.removeClass('icon-pause').addClass('icon-play');
      $controls.prev.disable();
      $controls.next.disable();
      playback.stopPinging();
    }
    $controls.playpause.playing = function() {
      console.log("\n\nPLAYING\n\n");
      this.removeClass('icon-play').addClass('icon-pause');
      $controls.prev.enable();
      $controls.next.enable();
      playback.startPinging();
    }

    // search form
    $search_form = $('#search');
    $search_form.submit(search.submit);
    $search_results = $('#search-results');

    // set up our handlebars templates
    tracks_template = Handlebars.compile($('#tracks-hbs').html());
    search_results_template = Handlebars.compile($('#search-results-hbs').html());
    track_info_template = Handlebars.compile($('#track-info-hbs').html());

    // initialize mopidy
    mopidy = new Mopidy();
    mopidy.on(console.log.bind(console)); // log all events
    mopidy.on("event:tracklistChanged", tracklist.sync);
    mopidy.on("state:online", socket.online);
    mopidy.on("state:offline", socket.offline);
    mopidy.on("event:trackPlaybackStarted", playback.handlePlaybackStarted);
    mopidy.on("event:trackPlaybackPaused", playback.handlePlaybackPaused);
    mopidy.on("event:trackPlaybackResumed", playback.handlePlaybackResumed);
    mopidy.on("event:seeked", playback.handleSeeked);
    //mopidy.on("event:volumeChanged", playback.volumeChanged);

    $('[title]').tooltip();
  }
  $(init); // start it up on document ready

})(jQuery);
