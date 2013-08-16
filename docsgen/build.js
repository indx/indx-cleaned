/* jshint node:true */
(function () {

	'use strict';

	var fs = require('fs'),
		_ = require('underscore'),
		mu = require('mu2'),
		config = require('./config.js'),
		GrammarParser = require('./lib/grammar-parser.js'),
		allPromises = require('node-promise').all,
		Promise = require('node-promise').Promise,
		CJSON = require('circular-json'),
		ncp = require('ncp'),
		globp = require('glob'),
		clc = require('cli-color'),
		Backbone = require('backbone'),
		marked = require('marked');

	mu.root = __dirname + '/template';

	var markedOptions = {
		gfm: true,
		highlight: function (code, lang, callback) {
			pygmentize({ lang: lang, format: 'html' }, code, function (err, result) {
				if (err) return callback(err);
				callback(null, result.toString());
			});
		},
		tables: true,
		breaks: false,
		pedantic: false,
		sanitize: true,
		smartLists: true,
		smartypants: false,
		langPrefix: 'lang-'
	};

	var methodGrammar = new GrammarParser('./grammars/method-grammar'),
		fileGrammar = new GrammarParser('./grammars/file-grammar');


	var Model = Backbone.Model.extend({
			defaults: {
				name: '',
				description: '',
				last: false
			},
			initialize: function () {
				this.parsed = new Promise();
				this.set('id', this.uid ? this.uid() : Math.random());
			},
			afterParsed: function (fn) { return this.parsed.then(fn); },
			object: function () { return this.toJSON(); }
		}),
		Collection = Backbone.Collection.extend({
			array: function () {
				return this.map(function (o) {
					return o.object();
				});
			},
			parseModels: function () {
				var that = this,
					promise = new Promise();
				if (that.length > 0) {
					this.each(function (file, i) {
						if (i > 0) {
							that.at(i - 1).afterParsed(function () { file.parse(); });
						} else {
							file.parse();
						}
					});
					this.last()
						.set('last', true)
						.afterParsed(function () { promise.resolve(); });
				} else {
					promise.resolve();
				}
				return promise;
			}
		});




	var Builder = Backbone.Model.extend({
		initialize: function () {
			var that = this;
			this.ready = new Promise();
			that.files = new Files();
			this.superclasses = new Classes([new ObjectClass()], { builder: builder });

			this._buildFilePaths().then(function (filenames) {
				that.set('filenames', filenames);
				_.each(filenames, function (filename) {
					that.files.add({ filename: filename }, { builder: that });
				});
				that.ready.resolve();
			});
		},
		pushClasses: function (classes) {
			var that = this;
			classes.each(function (cls) { that.superclasses.add(cls); });
		},
		build: function () {
			var that = this;
			this.ready.then(function () {
				log('build', 'starting build process');
				that.files.parse().then(function () {
					that.render();
				});
			});
		},
		render: function () {
			var that = this,
				html = '',
				outputDir = this.get('outputDirectory');

			log('build', 'rendering to ' + outputDir);

			deleteFolderRecursive(outputDir);
			ncp('./template', outputDir, function (err) {
				if (err) { throw err; }
				mu.compileAndRender('index.mu', that.object()).on('data', function (dat) {
					html += dat.toString();
				}).on('end', function () {
					fs.writeFile(outputDir + '/index.html', html, function (err) {
						if (err) { throw err; }
					});
				});
			});
		},
		// Expands globs into paths
		_buildFilePaths: function () {
			log('build', 'building file paths');
			var that = this,
				promise = new Promise(),
				lastPromise = new Promise(),
				files = [];

			_.each(this.get('filePaths'), function (glob, i) {
				var promise = new Promise();
				lastPromise.then(function () {
					globp(that.get('basePath') + glob, { }, function (err, globFiles) {
						files = files.concat(globFiles);
						promise.resolve();
					});
				});
				if (i === 0) { lastPromise.resolve(); }
				lastPromise = promise;
			});

			lastPromise.then(function () {
				log('build', 'got ' + files.length + ' file paths');
				promise.resolve(files);
			});

			return promise;
		},
		object: function () {
			var o = _.extend(this.toJSON(), {
				files: this.files.array()
			});
			return _.extend({
				json: CJSON.stringify(o)
			}, o);
		}
	});

	var File = Model.extend({
		initialize: function (attributes, options) {
			Model.prototype.initialize.apply(this, arguments);
			this.builder = options.builder;
		},
		parse: function () {
			log('parse file', this.get('filename'));
			var that = this;
			fs.readFile(this.get('filename'), function (err, data) {
				log('read', that.get('filename'));
				if (err) { throw err; }
				that.data = data.toString();
				that.classes = new Classes(undefined, { builder: builder, file: that, data: that.data });
				that.parseComment().then(function () {
					that.classes.parse();
					builder.pushClasses(that.classes);
					that.parsed.resolve();
				});
			});
		},
		parseComment: function () {
			var that = this,
				comment = getCommentAfter(this.data, 0),
				promise = new Promise();
			console.log(comment);
			fileGrammar.parse(comment).then(function (rs) {
				marked(rs.description.join('\n'), markedOptions, function (err, content) {
					if (err) { throw err; }
					rs.description = content;
					that.set(rs);
					promise.resolve();
				});

			});
			return promise;
		},
		object: function () {
			return _.extend(this.toJSON(), {
				classes: this.classes.array()
			});
		},
		uid: function () {
			return 'file-' + this.get('filename').replace(/\W+/gi, '-');
		}
	});

	var Files = Collection.extend({
		model: File,
		parse: function () { return this.parseModels(); }
	});

	var Class = Model.extend({
		initialize: function (attributes, options) {
			this.data = options ? options.data : undefined;
			this.file = options ? options.file : undefined;
			Model.prototype.initialize.apply(this, arguments);
			this.methods = new Methods(undefined, { cls: this, data: this.data });

			this.set('instanceName', this.get('name').charAt(0).toLowerCase() +
				this.get('name').substr(1));

			this.regexps = [
				['([^\\s.]*) *= *' + (this.get('fullName') || this.get('name')) + '\\.extend\\(', function (match, name, pos) {
					return { match: match, name: name, start: pos, fullName: name };
				}]
			];
		},
		parse: function () {
			log('parse class', this.get('name'));
			var that = this;

			//this.parseComment().then(function () {
				that.methods.parse();
				that.parsed.resolve();
			//});

		},
		/*parseComment: function () {
			var that = this,
				comment = getCommentAfter(this.data, 0);
			return classGrammar.parse(comment).then(function (rs) {
				rs.description = rs.description.join('<br>')
				console.log("P", rs)
				that.set(rs);
			});
		},*/
		object: function () {
			return _.extend(this.toJSON(), {
				methods: this.methods.array()
			});
		},
		uid: function () {
			return (this.file ? this.file.id : '') + '_class-' + this.get('name').replace(/\W+/gi, '');
		}
	});


	var ObjectClass = Class.extend({
		initialize: function () {
			Class.prototype.initialize.apply(this, arguments);
			this.regexps = [
				['([^\\s]*[\\.|\\s]+([A-Z][^\\s\\.]*)) *= *function *\\(([^\\)]*)\\)', function (match, fullName, name, n, pos) {
					return { match: match, name: name, fullName: fullName, start: pos };
				}],
				['function\\s*([A-Z][^\\s.]*) *\\(([^\\)]*)\\)', function (match, name, pos) {
					return { match: match, name: name, start: pos };
				}]
			];
		}
	});

	var Classes = Collection.extend({
		model: Class,
		initialize: function (models, options) {
			this.builder = options.builder;
			this.file = options.file;
			this.data = options.data
		},
		parse: function () {
			var that = this,
				superclasses = builder.superclasses;
			// Find each class that extends each superclass
			superclasses.each(function (superCls) {
				_.each(superCls.regexps, function (regexp) {
					var re = new RegExp(regexp[0], 'g');
					that.data.replace(re, function () {
						var match = regexp[1].apply(this, arguments);
						that.add(_.extend({
							extend: superCls
						}, match), { data: that.data, file: that.file });
					});

				});
			});

			// Infer that the end the each class is the start of the next
			that.each(function (cls, i) {
				if (i > 0) { that.at(i - 1).set('end', cls.get('start') - 1); }
			});
			// ... or the end of the file
			if (that.length > 0) { that.last().set('end', that.data.length - 1); }
			// Parse each class
			return this.parseModels();
		}
	});

	var Method = Model.extend({
		initialize: function (attributes, options) {
			this.data = options.data;
			this.cls = options.cls;
			Model.prototype.initialize.apply(this, arguments);
			var args = _.chain(this.get('args').split(',')).map(function (arg) {
				return { name: arg.trim() };
			}).reject(function (o) {
				return o.name.length === 0;
			}).value();
			this.unset('args');
			this.arguments = new Arguments(args, { method: this });
		},
		parse: function () {
			log('parse method', this.get('name'));

			var that = this;
			this.parseComment().then(function () {
				that.arguments.parse().then(function () {;
					if (that.arguments.length > 0) {
						that.set('hasArgs', true);
						that.parsed.resolve();
					}
				});
			});
		},
		parseComment: function () {
			var that = this,
				comment = getCommentBefore(this.data, this.get('start'))
			return methodGrammar.parse(comment).then(function (rs) {
				that.set(rs);
				if (that.get('args')) {
					that.arguments.reset(that.get('args'));
				}
				that.unset('args');
			});
		},
		object: function () {
			if (this.arguments.last()) { this.arguments.last().set('last', true); }
			return _.extend(this.toJSON(), {
				args: this.arguments.array()
			});
		},
		uid: function () {
			return this.cls.id + '_method-' + this.get('name').replace(/\W+/gi, '');
		}
	})

	var Methods = Collection.extend({
		model: Method,
		initialize: function (models, options) {
			this.cls = options.cls;
			this.data = options.data;
		},
		parse: function () {
			var that = this,
				start = this.cls.get('start'),
				end = this.cls.get('end'),
				data = this.data,
				subdata = data.substring(start, end),
				methods = [];

			var re = new RegExp('[\\.|\\s]+([a-z_][^\\s.]*) *[:=] *function *\\(([^\\)]*)\\)', 'g');

			subdata.replace(re, function (match, name, args, pos) {
				if (name.indexOf('_') === 0) { return; }
				var method = {
						name: name,
						start: start + pos,
						args: args,
						line: lineNumber(data, start + pos)
					};

				that.add(method, { data: that.data, cls: that.cls });

				return match;
			});

			return this.parseModels();
		}
	});

	var Argument = Model.extend({
		initialize: function (attributes, options) {
			this.args = options.args;
			this.method = this.collection.method;
			Model.prototype.initialize.apply(this, arguments);
		},
		parse: function () {
			log('parse argument', this.get('name'));

			this.set('moreInfo', !!this.get('types') || !!this.get('comment'));
			var types = this.get('types');
			if (types && types.length > 0) {
				this.set('hasTypes', true);
				_.each(types, function (type) {
					type.last = false;
				});
				types[types.length - 1].last = true;
			}

			this.parsed.resolve();
		},
		uid: function () {
			return this.method.id + '_argument-' + this.get('name').replace(/\W+/gi, '');
		}
	})

	var Arguments = Collection.extend({
		model: Argument,
		initialize: function (models, options) {
			this.method = options.method;
		},
		parse: function () {
			return this.parseModels();
		}
	});


	function log (context, message) {
		console.log(' ' + clc.green(context) + ' ' + message);
	}


	function getCommentBefore (data, start) {
		var subdata = data.substring(0, start),
			lines = subdata.split('\n').reverse();
		return getComment(lines).reverse().join('\n');
	}

	function getCommentAfter (data, start) {
		var subdata = data.substring(start - 1), // FIXME: not sure why -1
			lines = subdata.split('\n');
		return getComment(lines).join('\n');
	}

	function getComment (lines) {
		var commentLines = [],
			i, l, line;
		for (i = 1, l = lines.length; i < l; i++) {
			line = lines[i].trim();
			if (line.length === 0 || line.indexOf('/*') === 0) { continue; }
			if (line.indexOf('///') !== 0) { break; }
			commentLines.push(line);
		}
		return commentLines;
	}

	function deleteFolderRecursive (path) {
		var files = [];
		if( fs.existsSync(path) ) {
			files = fs.readdirSync(path);
			files.forEach(function(file,index){
				var curPath = path + "/" + file;
				if(fs.statSync(curPath).isDirectory()) { // recurse
					deleteFolderRecursive(curPath);
				} else { // delete file
					fs.unlinkSync(curPath);
				}
			});
			fs.rmdirSync(path);
		}
	}

	function lineNumber (data, charNumber) {
		return data.substring(0, charNumber).split('\n').length + 1;
	}


	var builder = new Builder(config);
	builder.build();

}());