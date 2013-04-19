/*global $,_,document,window,console,escape,Backbone,exports,WebSocket */
/*jslint vars:true todo:true sloppy:true */

(function() { 
	angular
		.module('webbox-widgets')
		.directive('modeltable', function() {
			return {
				restrict: 'E',
				scope:{},  // model:"=m" }, // these means the attribute 'm' has the name of the scope variable to use
				templateUrl:'/components/modeltable/modeltable.html',
				controller:function($scope, $attrs, webbox) {
					webbox.loaded.then(function() {
						// incoming : $scope.model <- inherited from parent scope via attribute m
						// $scope.uimodel <- gets set and manipulated by the ui
						// @attrs:
						//    box - box name
						//    parsechar - character to use to parse

						console.log("MODELTABLE box >> ", $scope.$parent.$eval($attrs.boxideval));
						console.log("MODELTABLE model >> ", $scope.$parent.$eval($attrs.modelideval));
						
						var modelid = $attrs.modelideval ? $scope.$parent.$eval($attrs.modelideval) : undefined;
						var u = webbox.u; // backbone model
						var parsechar = $attrs.parsechar || ',';
						var boxname = $attrs.box || ($attrs.boxideval && $scope.$parent.$eval($attrs.boxideval)), box;
						var resolve_fields = ['name', 'label', 'first_name'];
						var make_uiobj = function(key,val) {
							return { key: key, old_key: key, value: val, old_val : val };
						};
						var modeltoview = function(m) {
							// makes a ui model
							var m = $scope.model;
							if (m === undefined) { return []; }
							if (m === undefined) {
								console.log(" m is undefined ? ", m);
								return [];
							}
							return _(m.attributes).map(function(vs,k) {
								if (['@id'].indexOf(k) >= 0) { return; }
								var vals = vs.map(_serialise).filter(u.defined);
								return make_uiobj(k,vals);
							}).filter(u.defined);
						};
						var _update_in_place = function() {
							var newmodel = $scope.model;
							var new_keys = newmodel.omit(['@id', '@type'].concat(_($scope.uimodel).map(function(x) { return x.key; })));
							console.log("ui model >> ", newmodel.keys().length, $scope.uimodel.length,_(new_keys).keys().length, new_keys);
							var new_ui_objs = _(new_keys).map(function(v,k) { return make_uiobj(k,v); });
							var dead_ui_objs = _($scope.uimodel).map(function(uio) {
								if (newmodel.keys().indexOf(uio.key) < 0) { return uio; }
							}).filter(u.defined);
							_($scope.uimodel).difference(dead_ui_objs).map(function(uio) {
								// update objects in place
								var uik = uio.key, uivs = uio.value, mvs = newmodel.get(uik).map(_serialise);
								var newvs = _(mvs).difference(uivs);
								var oldvs = _(uivs).intersection(mvs);
								uio.value = _(oldvs).concat(newvs);
							});
							$scope.uimodel = _($scope.uimodel).difference(dead_ui_objs).concat(new_ui_objs);
						};
						var update_uimodel = function() {
							if ($scope.model === undefined) { return console.warn('$scope.model is undefined'); };
							if ($scope.uimodel === undefined) {
								var m2v = modeltoview();
								console.log("modeltoview >> ", m2v, "from scope model ", $scope.model);
								$scope.uimodel = m2v;							
							} else {
								// update inplace!
								// _update_in_place();
							}
						};
						// model -> view
						var _serialise = function(v) {
							if (v instanceof WebBox.Obj || v instanceof WebBox.File) {  return v.name || v.id;	  }
							return v.toString();
						};								 
						// view -> model
						var parse = function(v) {
							// this tries to figure out what the user meant, including resolving
							// references to entities
							var d = u.deferred();
							if (!_.isNaN( parseFloat(v) )) { d.resolve(parseFloat(v)); }
							if (!_.isNaN( parseInt(v, 10) )) { d.resolve(parseInt(v, 10)); }
							if (box) {
								var stripstrv = v.toString().trim();
								if ( box.get_obj_ids().indexOf(stripstrv) >= 0 ) {
									box.get_obj(stripstrv).then(d.resolve).fail(d.reject);
								} else {
									// todo: get by names too
									var matches = box._objcache().filter(function(obj) {
										var fields = resolve_fields.map(function(f) { return obj.get(f); }).filter(u.defined).filter(function(x) { return x.length > 0; });
										return fields.indexOf(stripstrv) >= 0; 
									});
									if (matches.length > 0) {
										d.resolve(matches[0]);
									} else {
										console.log("no matches, resolving with v ", v);
										d.resolve(v);
									}
								}
							}
							return d.promise();
						};
						var _select2_val_out = function(v) { if (v.text) { return v.text.trim(); } };
						var parseview = function() {
							var viewobj = $scope.uimodel, model = $scope.model;
							var pdfd = u.deferred();
							// delete the changed keys
							viewobj.filter(function(x) { return x.old_key !== x.key; })
								.map(function(x) {
									model.unset(x.old_key);
									x.old_key = x.key; // update for next time!
								});
							// now parse out the val
							u.when(viewobj.map(function(propertyval) {
								var v = propertyval.value, k = propertyval.key;
								var d = u.deferred();
								console.log('v >> ', v, v.map(_select2_val_out));
								var parsed_and_resolved = v.map(_select2_val_out).filter(u.defined).map(parse);
								u.when(parsed_and_resolved).then(function() {
									var vals = _.toArray(arguments);
									console.log('parsed & resolved ', vals);
									model.set(k, vals);
									d.resolve();
								}).fail(d.reject);
								return d.promise();
							})).then(function() { pdfd.resolve(model); }).fail(pdfd.reject);
							return pdfd.promise();
						};
						$scope.new_row = function() {
							console.log('new _ row ');
							var idx = _($scope.uimodel).keys().length + 1;
							var new_key = 'property '+idx;
							$scope.uimodel.push({ key: new_key, old_key: new_key, value:'', old_val: ''});
						};
						
						$scope.checkPropertyClass = function(propertyval) {
							var result = propertyval.key.length > 0 ? 'valid' : 'invalid';
							return result;
						};				  
						var find_invalid_uimodel_properties = function(uimodel) {
							return uimodel.filter(function(pv) { return $scope.checkPropertyClass(pv) === 'invalid'; });
						};
						$scope.commit_model = function() {
							var d = u.deferred();
							if ($scope.model !== undefined) {
								if (find_invalid_uimodel_properties($scope.uimodel).length === 0) {
									console.log('calling parseview >> ');
									parseview().then(function(vals) {
										console.log('saving model >> ', $scope.model.attributes);
										$scope.model.save();
									}).fail(function(err) {
										u.error('error committing model ', err);
										d.reject(err);
									});
								} else {
									console.error('invalid properties ', find_invalid_uimodel_properties($scope.uimodel));
									d.reject();
								}
							}
							return d.promise();
						};
						$scope.delete_property = function(propertyval) {
							var model = $scope.model;
							var key = propertyval.key;
							console.log('unsetting ', key);
							model.unset(key);
							$scope.uimodel = _($scope.uimodel).without(propertyval);
							$scope.commit_model();
						};

						// initialise
						if (boxname) {
							box = webbox.store.get_or_create_box(boxname);
							box.fetch().then(function() {
								$scope.loaded = true;
								$scope.box_objs = box.get_obj_ids();
								if (modelid) {
									console.log(' getting  modelid ', modelid);									
									box.get_obj(modelid).then(function(model) {
										// console.log(' ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ setting model',model, _(model.attributes).keys().length);
										console.log('got model >> ', modelid, model);
										$scope.model = model;
										update_uimodel();
										$scope.model.on('change', function() {
											console.log('MODEL CHANGE >> ', $scope.model.id);
											update_uimodel();
										});										
									});
								} else {
									// already have the model can update directly
									console.log('already have the model can update directly ');
									update_uimodel();
									$scope.$watch('model', update_uimodel);									
								}

							}).fail(function(err) { $scope.error = err; });
						}				  
					});
				}
			};
		});
}());
