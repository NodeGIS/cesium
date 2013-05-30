/*global define*/
define([
        './defaultValue',
        './BoundingSphere',
        './Cartesian2',
        './Cartesian3',
        './Cartographic',
        './ComponentDatatype',
        './DeveloperError',
        './Ellipsoid',
        './GeographicProjection',
        './GeometryAttribute',
        './GeometryIndices',
        './Math',
        './Matrix2',
        './Matrix3',
        './Matrix4',
        './PrimitiveType',
        './Quaternion',
        './VertexFormat'
    ], function(
        defaultValue,
        BoundingSphere,
        Cartesian2,
        Cartesian3,
        Cartographic,
        ComponentDatatype,
        DeveloperError,
        Ellipsoid,
        GeographicProjection,
        GeometryAttribute,
        GeometryIndices,
        CesiumMath,
        Matrix2,
        Matrix3,
        Matrix4,
        PrimitiveType,
        Quaternion,
        VertexFormat) {
    "use strict";

    function reflect(position, center, unitVector, result) {
        var toCenter = Cartesian3.subtract(position, center);
        Cartesian3.multiplyByScalar(unitVector, Cartesian3.dot(toCenter, unitVector), result);
        var perp = Cartesian3.subtract(toCenter, result);
        Cartesian3.negate(perp, perp);
        Cartesian3.add(perp, result, result);
        Cartesian3.add(center, result, result);
        return result;
    }

    var scratchCartesian1 = new Cartesian3();
    var scratchCartesian2 = new Cartesian3();
    var scratchCartesian3 = new Cartesian3();
    var scratchCartesian4 = new Cartesian3();
    var scratchCartographic = new Cartographic();
    var scratchMatrix2 = new Matrix2();

    /**
     * Computes vertices and indices for an ellipse on the ellipsoid.
     *
     * @alias EllipseGeometry
     * @constructor
     *
     * @param {Cartesian3} options.center The ellipse's center point in the fixed frame.
     * @param {Number} options.semiMajorAxis The length of the ellipse's semi-major axis in meters.
     * @param {Number} options.semiMinorAxis The length of the ellipse's semi-minor axis in meters.
     * @param {Ellipsoid} [options.ellipsoid=Ellipsoid.WGS84] The ellipsoid the ellipse will be on.
     * @param {Number} [options.height=0.0] The height above the ellipsoid.
     * @param {Number} [options.bearing=0.0] The angle from north (clockwise) in radians. The default is zero.
     * @param {Number} [options.granularity=0.02] The angular distance between points on the ellipse in radians.
     * @param {VertexFormat} [options.vertexFormat=VertexFormat.DEFAULT] The vertex attributes to be computed.
     * @param {Matrix4} [options.modelMatrix] The model matrix for this ellipsoid.
     * @param {DOC_TBA} [options.pickData] DOC_TBA
     *
     * @exception {DeveloperError} center is required.
     * @exception {DeveloperError} semiMajorAxis is required.
     * @exception {DeveloperError} semiMinorAxis is required.
     * @exception {DeveloperError} semiMajorAxis and semiMinorAxis must be greater than zero.
     * @exception {DeveloperError} granularity must be greater than zero.
     *
     * @example
     * // Create an ellipse.
     * var ellipsoid = Ellipsoid.WGS84;
     * var ellipse = new EllipseGeometry({
     *     ellipsoid : ellipsoid,
     *     center : ellipsoid.cartographicToCartesian(Cartographic.fromDegrees(-75.59777, 40.03883)),
     *     semiMajorAxis : 500000.0,
     *     semiMinorAxis : 300000.0,
     *     bearing : CesiumMath.toRadians(60.0)
     * });
     */
    var EllipseGeometry = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);
        var center = options.center;
        var semiMajorAxis = options.semiMajorAxis;
        var semiMinorAxis = options.semiMinorAxis;

        var ellipsoid = defaultValue(options.ellipsoid, Ellipsoid.WGS84);
        var bearing = defaultValue(options.bearing, 0.0);
        var height = defaultValue(options.height, 0.0);
        var granularity = defaultValue(options.granularity, 0.02);

        if (typeof center === 'undefined') {
            throw new DeveloperError('center is required.');
        }

        if (typeof semiMajorAxis === 'undefined') {
            throw new DeveloperError('semiMajorAxis is required.');
        }

        if (typeof semiMinorAxis === 'undefined') {
            throw new DeveloperError('semiMinorAxis is required.');
        }

        if (semiMajorAxis <= 0.0 || semiMinorAxis <= 0.0) {
            throw new DeveloperError('Semi-major and semi-minor axes must be greater than zero.');
        }

        if (granularity <= 0.0) {
            throw new DeveloperError('granularity must be greater than zero.');
        }

        if (semiMajorAxis < semiMinorAxis) {
           var temp = semiMajorAxis;
           semiMajorAxis = semiMinorAxis;
           semiMinorAxis = temp;
        }

        var vertexFormat = defaultValue(options.vertexFormat, VertexFormat.DEFAULT);

        var MAX_ANOMALY_LIMIT = 2.31;

        //var aSqr = semiMajorAxis * semiMajorAxis;
        //var bSqr = semiMinorAxis * semiMinorAxis;
        var aSqr = semiMinorAxis * semiMinorAxis;
        var bSqr = semiMajorAxis * semiMajorAxis;
        var ab = semiMajorAxis * semiMinorAxis;

        var mag = center.magnitude();

        var unitPos = Cartesian3.normalize(center);
        var eastVec = Cartesian3.cross(Cartesian3.UNIT_Z, center);
        Cartesian3.normalize(eastVec, eastVec);
        var northVec = Cartesian3.cross(unitPos, eastVec);

        // The number of points in the first quadrant
        var numPts = 1 + Math.ceil(CesiumMath.PI_OVER_TWO / granularity);
        var deltaTheta = MAX_ANOMALY_LIMIT / (numPts - 1);

        // If the number of points were three, the ellipse
        // would be tessellated like below:
        //
        //         *---*
        //       / | \ | \
        //     *---*---*---*
        //   / | \ | \ | \ | \
        // *---*---*---*---*---*
        //   \ | \ | \ | \ | /
        //     *---*---*---*
        //       \ | \ | /
        //         *---*
        // Notice each vertical column contains an odd number of positions.
        // The sum of the first n odd numbers is n^2. Double it for the number of points
        // for the whole ellipse
        //var size = 2 * numPts * numPts;

        // Compute the points in the positive x half-space in 2D.
        /*var positions = new Array(size * 3);
        positions[0] = semiMajorAxis;
        positions[1] = 0.0;
        positions[2] = height;
        var positionIndex = 3;
        */

        var rotation = Matrix3.fromQuaternion(Quaternion.fromAxisAngle(unitPos, bearing));
        var rotatedNorthVec = Matrix3.multiplyByVector(rotation, northVec);
        var rotatedEastVec = Matrix3.multiplyByVector(rotation, eastVec);
        Cartesian3.normalize(rotatedNorthVec, rotatedNorthVec);
        Cartesian3.normalize(rotatedEastVec, rotatedEastVec);

        var position = scratchCartesian1;
        var reflectedPosition = scratchCartesian2;

        var positions = [];
        var positionIndex = 0;

        var i;
        var j;
        var numInterior;
        var theta;

        for (i = 0, theta = CesiumMath.PI_OVER_TWO; i < numPts && theta > 0; ++i, theta -= deltaTheta) {
            var azimuth = theta + bearing;
            var rotAxis = Cartesian3.multiplyByScalar(eastVec,  Math.cos(azimuth));
            var tempVec = Cartesian3.multiplyByScalar(northVec, Math.sin(azimuth));
            Cartesian3.add(rotAxis, tempVec, rotAxis);

            var cosThetaSquared = Math.cos(theta);
            cosThetaSquared = cosThetaSquared * cosThetaSquared;

            var sinThetaSquared = Math.sin(theta);
            sinThetaSquared = sinThetaSquared * sinThetaSquared;

            var radius = ab / Math.sqrt(bSqr * cosThetaSquared + aSqr * sinThetaSquared);
            var angle = radius / mag;

            // Create the quaternion to rotate the position vector to the boundary of the ellipse.
            var unitQuat = Quaternion.fromAxisAngle(rotAxis, angle);
            var rotMtx = Matrix3.fromQuaternion(unitQuat);

            Matrix3.multiplyByVector(rotMtx, unitPos, position);
            Cartesian3.normalize(position, position);
            Cartesian3.multiplyByScalar(position, mag, position);

            reflect(position, center, rotatedEastVec, reflectedPosition);

            positions[positionIndex++] = position.x;
            positions[positionIndex++] = position.y;
            positions[positionIndex++] = position.z;

            numInterior = 2 * i + 2;
            for (j = 1; j < numInterior - 1; ++j) {
                var t = j / (numInterior - 1);
                var interiorPosition = Cartesian3.lerp(position, reflectedPosition, t, scratchCartesian3);
                positions[positionIndex++] = interiorPosition.x;
                positions[positionIndex++] = interiorPosition.y;
                positions[positionIndex++] = interiorPosition.z;
            }

            positions[positionIndex++] = reflectedPosition.x;
            positions[positionIndex++] = reflectedPosition.y;
            positions[positionIndex++] = reflectedPosition.z;
        }

        numPts = i;

        var reverseIndex = positionIndex;

        // Reflect the points across the y axis to get the other half of the ellipsoid.
        for (i = numPts; i > 0; --i) {
            numInterior = 2 * i;
            reverseIndex -= numInterior * 3;
            for (j = 0; j < numInterior; ++j) {
                var index = reverseIndex + j * 3;
                Cartesian3.fromArray(positions, index, position);
                reflect(position, center, rotatedNorthVec, reflectedPosition);

                positions[positionIndex++] = reflectedPosition.x;
                positions[positionIndex++] = reflectedPosition.y;
                positions[positionIndex++] = reflectedPosition.z;
            }
        }

        /*
        var textureCoordinates = (vertexFormat.st) ? new Array(size * 2) : undefined;
        var normals = (vertexFormat.normal) ? new Array(size * 3) : undefined;
        var tangents = (vertexFormat.tangent) ? new Array(size * 3) : undefined;
        var binormals = (vertexFormat.binormal) ? new Array(size * 3) : undefined;

        var textureCoordIndex = 0;

        // Rotate/translate the positions in the xy-plane and un-project to the ellipsoid in 3D.
        // Compute the texture coordinates, normals, tangents, and binormals at the same times.
        var projection = new GeographicProjection(ellipsoid);
        var centerCart = ellipsoid.cartesianToCartographic(center, scratchCartographic);
        var projectedCenter = projection.project(centerCart, scratchCartesian1);
        var rotation = Matrix2.fromRotation(bearing, scratchMatrix2);

        var normal;
        var tangent;
        var binormal;
        */

        var length = positions.length;
        for (i = 0; i < length; i += 3) {
            position = Cartesian3.fromArray(positions, i, scratchCartesian2);
            ellipsoid.scaleToGeodeticSurface(position, position);
            Cartesian3.add(position, Cartesian3.multiplyByScalar(ellipsoid.geodeticSurfaceNormal(position), height), position);

            /*
            if (vertexFormat.st) {
                textureCoordinates[textureCoordIndex++] = (position.x + semiMajorAxis) / (2.0 * semiMajorAxis);
                textureCoordinates[textureCoordIndex++] = (position.y + semiMinorAxis) / (2.0 * semiMinorAxis);
            }

            Matrix2.multiplyByVector(rotation, position, position);
            Cartesian2.add(projectedCenter, position, position);

            var unprojected = projection.unproject(position, scratchCartographic);
            ellipsoid.cartographicToCartesian(unprojected, position);
            */

            if (vertexFormat.position) {
                positions[i] = position.x;
                positions[i + 1] = position.y;
                positions[i + 2] = position.z;
            }

            /*
            if (vertexFormat.normal) {
                normal = ellipsoid.geodeticSurfaceNormal(position, scratchCartesian3);

                normals[i] = normal.x;
                normals[i + 1] = normal.y;
                normals[i + 2] = normal.z;
            }

            if (vertexFormat.tangent) {
                normal = ellipsoid.geodeticSurfaceNormal(position, scratchCartesian3);
                tangent = Cartesian3.cross(Cartesian3.UNIT_Z, normal, scratchCartesian3);

                tangents[i] = tangent.x;
                tangents[i + 1] = tangent.y;
                tangents[i + 2] = tangent.z;
            }

            if (vertexFormat.binormal) {
                normal = ellipsoid.geodeticSurfaceNormal(position, scratchCartesian3);
                tangent = Cartesian3.cross(Cartesian3.UNIT_Z, normal, scratchCartesian4);
                binormal = Cartesian3.cross(normal, tangent, scratchCartesian3);

                binormals[i] = binormal.x;
                binormals[i + 1] = binormal.y;
                binormals[i + 2] = binormal.z;
            }
            */
        }

        var attributes = {};

        if (vertexFormat.position) {
            attributes.position = new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 3,
                values : positions
            });
        }

        /*
        if (vertexFormat.st) {
            attributes.st = new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 2,
                values : textureCoordinates
            });
        }

        if (vertexFormat.normal) {
            attributes.normal = new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 3,
                values : normals
            });
        }

        if (vertexFormat.tangent) {
            attributes.tangent = new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 3,
                values : tangents
            });
        }

        if (vertexFormat.binormal) {
            attributes.binormal = new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 3,
                values : binormals
            });
        }
        */

        // The number of triangles in the ellipse on the positive x half-space is:
        //
        // numInteriorTriangles = 4 + 8 + 12 + ... = 4 + (4 + 4) + (4 + 4 + 4) + ... = 4 * (1 + 2 + 3 + ...)
        //                      = 4 * ((n * ( n + 1)) / 2)
        // numExteriorTriangles = 2 * n
        //
        // Substitute (numPts - 1.0) for n above and then:
        //
        // numTriangles = 2 * (numInteriorTriangles + numExteriorTriangles)
        // numIndices = 3 * numTriangles
        //var indices = new Array(indicesSize);
        var indices = [];
        var indicesIndex = 0;
        var prevIndex;

        // Indices for positive x half-space
        for (i = 1; i < numPts; ++i) {
            positionIndex = i * (i + 1);
            prevIndex = (i - 1) * i;

            indices[indicesIndex++] = positionIndex++;
            indices[indicesIndex++] = positionIndex;
            indices[indicesIndex++] = prevIndex;

            numInterior = 2 * i;
            for (j = 0; j < numInterior - 1; ++j) {
                indices[indicesIndex++] = prevIndex++;
                indices[indicesIndex++] = positionIndex;
                indices[indicesIndex++] = prevIndex;

                indices[indicesIndex++] = positionIndex++;
                indices[indicesIndex++] = positionIndex;
                indices[indicesIndex++] = prevIndex;
            }

            indices[indicesIndex++] = positionIndex++;
            indices[indicesIndex++] = positionIndex;
            indices[indicesIndex++] = prevIndex;
        }

        // Indices for central column of triangles
        numInterior = numPts * 2;
        ++positionIndex;
        ++prevIndex;
        for (i = 0; i < numInterior - 1; ++i) {
            indices[indicesIndex++] = prevIndex++;
            indices[indicesIndex++] = positionIndex;
            indices[indicesIndex++] = prevIndex;

            indices[indicesIndex++] = positionIndex++;
            indices[indicesIndex++] = positionIndex;
            indices[indicesIndex++] = prevIndex;
        }

        // Reverse the process creating indices for the ellipse on the positive x half-space
        // to create the part of the ellipse reflected on the y axis.
        ++prevIndex;
        ++positionIndex;
        for (i = numPts - 1; i > 0; --i) {
            indices[indicesIndex++] = prevIndex++;
            indices[indicesIndex++] = positionIndex;
            indices[indicesIndex++] = prevIndex;

            numInterior = 2 * i;
            for (j = 0; j < numInterior - 1; ++j) {
                indices[indicesIndex++] = prevIndex++;
                indices[indicesIndex++] = positionIndex;
                indices[indicesIndex++] = prevIndex;

                indices[indicesIndex++] = positionIndex++;
                indices[indicesIndex++] = positionIndex;
                indices[indicesIndex++] = prevIndex;
            }

            indices[indicesIndex++] = prevIndex++;
            indices[indicesIndex++] = positionIndex++;
            indices[indicesIndex++] = prevIndex++;
        }

        //indices.length = indicesIndex;

        /**
         * An object containing {@link GeometryAttribute} properties named after each of the
         * <code>true</code> values of the {@link VertexFormat} option.
         *
         * @type Object
         */
        this.attributes = attributes;

        /**
         * An array of {@link GeometryIndices} defining primitives.
         *
         * @type Array
         */
        this.indexLists = [
            new GeometryIndices({
                primitiveType : PrimitiveType.TRIANGLES,
                values : indices
            })
        ];

        /**
         * A tight-fitting bounding sphere that encloses the vertices of the geometry.
         *
         * @type BoundingSphere
         */
        this.boundingSphere = new BoundingSphere(center, semiMajorAxis);

        /**
         * The 4x4 transformation matrix that transforms the geometry from model to world coordinates.
         * When this is the identity matrix, the geometry is drawn in world coordinates, i.e., Earth's WGS84 coordinates.
         * Local reference frames can be used by providing a different transformation matrix, like that returned
         * by {@link Transforms.eastNorthUpToFixedFrame}.
         *
         * @type Matrix4
         *
         * @see Transforms.eastNorthUpToFixedFrame
         */
        this.modelMatrix = defaultValue(options.modelMatrix, Matrix4.IDENTITY.clone());

        /**
         * DOC_TBA
         */
        this.pickData = options.pickData;
    };

    return EllipseGeometry;
});