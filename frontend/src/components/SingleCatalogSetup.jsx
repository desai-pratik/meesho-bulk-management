import { useState, useEffect } from 'react';
import { useParams, useNavigate, NavLink } from 'react-router-dom';
import { Save, Image as ImageIcon, Search } from 'lucide-react';

function SingleCatalogSetup({ socket }) {
  const { category } = useParams();
  const activeCategory = category ? category.replace('-', '_') : 'jewellery_set';
  const defaultFormState = {
    gst: '', hsnCode: '', netWeight: '', productName: '', size: 'Free Size',
    meeshoPrice: '', wrongPrice: '', mrp: '', inventory: '', lengthSizeInch: '',

    baseMetal: '', genericName: '', includedComponents: '', netQuantity: '',
    occasion: '', plating: '', productDimensionUnit: '', productHeight: '',
    productLength: '', productWidth: '', sizing: '', stoneType: '',
    trend: '', type: '', countryOfOrigin: '', length: '',
    careInstructions: '', closureType: '', fillingMaterial: '', material: '',
    packagingBreadth: '', packagingHeight: '', packagingLength: '',
    packagingUnit: '', pattern: '', waterResistanceLevel: '', weightUnit: '',

    manufacturerName: '', manufacturerAddress: '', manufacturerPincode: '',
    packerName: '', packerAddress: '', packerPincode: '',
    importerName: '', importerAddress: '', importerPincode: '',

    addOn: '', brand: '', color: '', description: ''
  };

  const [formData, setFormData] = useState(defaultFormState);

  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [photoSearchQuery, setPhotoSearchQuery] = useState('');

  const fetchImages = () => {
    fetch('http://localhost:3001/api/single-catalog-images')
      .then(res => res.json())
      .then(data => setImages(data))
      .catch(console.error);
  };

  const fetchDefaults = () => {
    setLoading(true);
    fetch(`http://localhost:3001/api/single-catalog-defaults?category=${activeCategory}&t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          setFormData({ ...defaultFormState, ...data });
        } else {
          setFormData(defaultFormState);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchImages();
    fetchDefaults();
  }, [activeCategory]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`http://localhost:3001/api/single-catalog-defaults?category=${activeCategory}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        alert('Defaults saved successfully!');
      }
    } catch (e) {
      alert('Failed to save defaults.');
    }
  };



  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    setUploading(true);
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) {
      fd.append('files', files[i]);
    }

    try {
      const res = await fetch('http://localhost:3001/api/single-catalog-images', {
        method: 'POST',
        body: fd
      });
      if (res.ok) fetchImages();
    } catch (error) {
      console.error(error);
      alert('Failed to upload images.');
    } finally {
      setUploading(false);
      e.target.value = null;
    }
  };

  const handleDeleteImage = async (filename) => {
    if (!window.confirm(`Delete ${filename}?`)) return;
    try {
      const res = await fetch(`http://localhost:3001/api/single-catalog-images/${filename}`, { method: 'DELETE' });
      if (res.ok) fetchImages();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL uploaded photos?')) return;
    try {
      const res = await fetch('http://localhost:3001/api/single-catalog-images', { method: 'DELETE' });
      if (res.ok) fetchImages();
    } catch (error) {
      console.error(error);
    }
  };

  if (loading) return <div className="glass-panel">Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>Single Catalog Setup</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Set the default details for {activeCategory === 'jewellery_set' ? 'Jewellery Set' : 'Mangalsutras'} uploads. These will be applied to all your photos.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <NavLink 
              to="/single-catalog/jewellery-set"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Jewellery Set
            </NavLink>
            <NavLink 
              to="/single-catalog/mangalsutras"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Mangalsutras
            </NavLink>
            <NavLink 
              to="/single-catalog/mattress-protection"
              className={({ isActive }) => `btn ${isActive ? 'btn-primary' : 'glass-panel'}`}
            >
              Mattress Protection
            </NavLink>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <Save size={16} /> Save Defaults
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Product, Size & Inventory</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group"><label className='form-label'>GST <span>*</span></label><input className="input-field" name="gst" value={formData.gst} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>HSN Code <span>*</span></label><input className="input-field" name="hsnCode" value={formData.hsnCode} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Net Weight (gms) <span>*</span></label><input className="input-field" name="netWeight" value={formData.netWeight} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Product Name <span>*</span></label><input className="input-field" name="productName" value={formData.productName} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Size <span>*</span></label><input className="input-field" name="size" value={formData.size} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Inventory <span>*</span></label><input className="input-field" name="inventory" value={formData.inventory} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Meesho Price <span>*</span></label><input className="input-field" name="meeshoPrice" value={formData.meeshoPrice} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Wrong/Defective Price</label><input className="input-field" name="wrongPrice" value={formData.wrongPrice} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>MRP <span>*</span></label><input className="input-field" name="mrp" value={formData.mrp} onChange={handleChange} /></div>
              {activeCategory === 'mangalsutras' && (
                <div className="form-group">
                  <label className='form-label'>Length Size (INCH)</label>
                  <input className="input-field" name="lengthSizeInch" value={formData.lengthSizeInch || ''} onChange={handleChange} placeholder="e.g. 18" />
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Other Attributes</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group"><label className='form-label'>Color</label><input className="input-field" name="color" value={formData.color} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Brand</label><input className="input-field" name="brand" value={formData.brand} onChange={handleChange} /></div>
              <div className="form-group"><label className='form-label'>Add On</label><input className="input-field" name="addOn" value={formData.addOn} onChange={handleChange} /></div>
              {activeCategory === 'mangalsutras' && (
                <div className="form-group">
                  <label className='form-label'>Type</label>
                  <input className="input-field" name="type" value={formData.type || ''} onChange={handleChange} placeholder="e.g. Big pendant mangalsutra" />
                </div>
              )}
              <div className="form-group" >
                <label className='form-label'>Description</label>
                <textarea className="input-field" style={{ height: '80px', resize: 'vertical' }} name="description" value={formData.description} onChange={handleChange} />
              </div>
            </div>
          </div>

        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Product Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {activeCategory === 'mattress_protection' ? (
                <>
                  <div className="form-group"><label className='form-label'>Care Instructions <span>*</span></label><input className="input-field" name="careInstructions" value={formData.careInstructions} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Closure Type <span>*</span></label><input className="input-field" name="closureType" value={formData.closureType} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Color <span>*</span></label><input className="input-field" name="color" value={formData.color} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Filling Material <span>*</span></label><input className="input-field" name="fillingMaterial" value={formData.fillingMaterial} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Generic Name <span>*</span></label><input className="input-field" name="genericName" value={formData.genericName} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Material <span>*</span></label><input className="input-field" name="material" value={formData.material} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Net Quantity (N) <span>*</span></label><input className="input-field" name="netQuantity" value={formData.netQuantity} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Breadth <span>*</span></label><input className="input-field" name="packagingBreadth" value={formData.packagingBreadth} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Height <span>*</span></label><input className="input-field" name="packagingHeight" value={formData.packagingHeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Length <span>*</span></label><input className="input-field" name="packagingLength" value={formData.packagingLength} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Packaging Unit <span>*</span></label><input className="input-field" name="packagingUnit" value={formData.packagingUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Pattern <span>*</span></label><input className="input-field" name="pattern" value={formData.pattern} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Breadth <span>*</span></label><input className="input-field" name="productBreadth" value={formData.productBreadth} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Height <span>*</span></label><input className="input-field" name="productHeight" value={formData.productHeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Length <span>*</span></label><input className="input-field" name="productLength" value={formData.productLength} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Unit <span>*</span></label><input className="input-field" name="productDimensionUnit" value={formData.productDimensionUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Weight <span>*</span></label><input className="input-field" name="productWeight" value={formData.productWeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Size <span>*</span></label><input className="input-field" name="sizing" value={formData.sizing} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Water Resistance Level <span>*</span></label><input className="input-field" name="waterResistanceLevel" value={formData.waterResistanceLevel} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Weight Unit <span>*</span></label><input className="input-field" name="weightUnit" value={formData.weightUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>COUNTRY OF ORIGIN <span>*</span></label><input className="input-field" name="countryOfOrigin" value={formData.countryOfOrigin} onChange={handleChange} /></div>
                </>
              ) : (
                <>
                  <div className="form-group"><label className='form-label'>Base Metal <span>*</span></label><input className="input-field" name="baseMetal" value={formData.baseMetal} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Plating <span>*</span></label><input className="input-field" name="plating" value={formData.plating} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Stone Type <span>*</span></label><input className="input-field" name="stoneType" value={formData.stoneType} onChange={handleChange} /></div>
                  {activeCategory !== 'mangalsutras' && (
                    <div className="form-group"><label className='form-label'>Type <span>*</span></label><input className="input-field" name="type" value={formData.type} onChange={handleChange} /></div>
                  )}
                  <div className="form-group"><label className='form-label'>Sizing <span>*</span></label><input className="input-field" name="sizing" value={formData.sizing} onChange={handleChange} /></div>
                  {activeCategory === 'mangalsutras' && (
                    <div className="form-group">
                      <label className='form-label'>Length <span>*</span></label>
                      <input className="input-field" name="length" value={formData.length || ''} onChange={handleChange} />
                    </div>
                  )}
                  <div className="form-group"><label className='form-label'>Trend <span>*</span></label><input className="input-field" name="trend" value={formData.trend} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Occasion <span>*</span></label><input className="input-field" name="occasion" value={formData.occasion} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Net Quantity (N) <span>*</span></label><input className="input-field" name="netQuantity" value={formData.netQuantity} onChange={handleChange} /></div>
                  {activeCategory !== 'mangalsutras' && (
                    <div className="form-group"><label className='form-label'>Included Components</label><input className="input-field" name="includedComponents" value={formData.includedComponents} onChange={handleChange} /></div>
                  )}
                  <div className="form-group"><label className='form-label'>Generic Name</label><input className="input-field" name="genericName" value={formData.genericName} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Country of Origin <span>*</span></label><input className="input-field" name="countryOfOrigin" value={formData.countryOfOrigin} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Dimension Unit</label><input className="input-field" name="productDimensionUnit" value={formData.productDimensionUnit} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Height</label><input className="input-field" name="productHeight" value={formData.productHeight} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Length</label><input className="input-field" name="productLength" value={formData.productLength} onChange={handleChange} /></div>
                  <div className="form-group"><label className='form-label'>Product Width</label><input className="input-field" name="productWidth" value={formData.productWidth} onChange={handleChange} /></div>
                </>
              )}
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Manufacturer & Packer</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Manufacturer</h4>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input className="input-field" placeholder="Name" name="manufacturerName" value={formData.manufacturerName} onChange={handleChange} />
                  <input className="input-field" placeholder="Address" name="manufacturerAddress" value={formData.manufacturerAddress} onChange={handleChange} />
                  <input className="input-field" placeholder="Pincode" name="manufacturerPincode" value={formData.manufacturerPincode} onChange={handleChange} style={{ width: '80px' }} />
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Packer</h4>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input className="input-field" placeholder="Name" name="packerName" value={formData.packerName} onChange={handleChange} />
                  <input className="input-field" placeholder="Address" name="packerAddress" value={formData.packerAddress} onChange={handleChange} />
                  <input className="input-field" placeholder="Pincode" name="packerPincode" value={formData.packerPincode} onChange={handleChange} style={{ width: '80px' }} />
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Importer</h4>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input className="input-field" placeholder="Name" name="importerName" value={formData.importerName} onChange={handleChange} />
                  <input className="input-field" placeholder="Address" name="importerAddress" value={formData.importerAddress} onChange={handleChange} />
                  <input className="input-field" placeholder="Pincode" name="importerPincode" value={formData.importerPincode} onChange={handleChange} style={{ width: '80px' }} />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Photo Upload Section */}
      <div className="glass-panel" style={{ marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ImageIcon size={18} /> Uploaded Photos ({images.length})
          </h3>
          
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="search"
                className="input-field"
                placeholder="Search photos..."
                value={photoSearchQuery}
                onChange={(e) => setPhotoSearchQuery(e.target.value)}
                style={{ paddingLeft: '32px', minWidth: '200px' }}
              />
            </div>
            {images.length > 0 && (
              <button
                className="btn"
                style={{ background: 'var(--danger)', color: 'white', border: 'none', cursor: 'pointer', padding: '0.5rem 1rem', borderRadius: '4px' }}
                onClick={handleDeleteAll}
                disabled={uploading}
              >
                Remove All Photos
              </button>
            )}
            <label className="btn btn-primary" style={{ cursor: 'pointer', padding: '0.5rem 1rem', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
              {uploading ? 'Uploading...' : 'Upload Photos'}
              <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
            </label>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          Upload your SKUs (e.g., `isr_2981.jpg`) and your common files (`_a.jpg`, `_b.jpg`, `_c.jpg`) here. The bot will read them from this list.
        </p>

        {images.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No images uploaded yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem' }}>
            {images
              .filter(img => !photoSearchQuery || img.name.toLowerCase().includes(photoSearchQuery.toLowerCase()))
              .map(img => (
              <div key={img.name} style={{ background: 'var(--bg-color)', borderRadius: '8px', padding: '0.3rem', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <div style={{ width: '100%', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', borderRadius: '4px', marginBottom: '0.5rem', overflow: 'hidden' }}>
                  <img
                    src={`http://localhost:3001/single_catalog_images/${encodeURIComponent(img.name)}`}
                    alt={img.name}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'block';
                    }}
                  />
                  <div style={{ display: 'none' }}><ImageIcon size={32} color="var(--text-muted)" /></div>
                </div>
                <div style={{ fontSize: '0.8rem', textAlign: 'center', wordBreak: 'break-all', width: '100%' }}>
                  {img.name}
                </div>
                <button
                  onClick={() => handleDeleteImage(img.name)}
                  style={{ position: 'absolute', top: '-1px', right: '-1px', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer' }}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

export default SingleCatalogSetup;
